import * as THREE from 'three';
import { TANK, HALF_W, HALF_D } from '../config.js';
import { SPECIES } from './species.js';
import { buildFish } from './fishGeometry.js';
import { makeFishMaterials, makeFishUniforms } from './fishMaterial.js';
import { sandHeight } from '../world/substrate.js';

const GEO_CACHE = {};
const BETTA_PALETTES = [
  [0x8a0410, 0x2050ff], [0x10209a, 0x30d0ff], [0xb01030, 0xffffff], [0x3a0a6a, 0xff3090], [0xd04008, 0xffd040],
];
const GUPPY_PALETTES = [
  [0xff6a1a, 0x2a5cff], [0xff2a3a, 0xffb020], [0x2fa8ff, 0x9a3cff], [0xffd23a, 0xff3a2a], [0x18d6a0, 0x1f5cff], [0xff5aa0, 0xffd0e0],
];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _q = new THREE.Quaternion();

export const STATE_LABEL = {
  wander: 'Dolaşıyor', school: 'Sürüyle yüzüyor', seek: 'Yem arıyor', eat: 'Yiyor', flee: 'Kaçıyor',
  sleep: 'Uyuyor', air: 'Yüzeyden hava alıyor', hide: 'Saklanıyor', forage: 'Kumu eşeliyor', curious: 'Seni izliyor', rest: 'Dinleniyor',
  chase: 'Rakibini kovalıyor', flare: 'Yüzgeçlerini açıp gösteriş yapıyor', hunt: 'Avlanıyor',
};

export class Fish {
  constructor(data) {
    this.data = data;                   // kaydedilen alanlar
    this.sp = SPECIES[data.species];
    const b = this.sp.body;
    const scale = data.size ?? 1;
    if (!GEO_CACHE[data.species]) {
      GEO_CACHE[data.species] = buildFish({
        ...b,
        belly: data.species === 'cory' ? 0.02 : 0.07,
        flatBelly: data.species === 'cory',
        barbels: data.species === 'cory',
        eyeSize: b.eyeSize ?? (data.species === 'neon' ? 0.165 : data.species === 'cory' ? 0.12 : 0.14),
        tailLift: b.tailLift ?? (data.species === 'guppy' ? 0.15 : 0),
        ventral: data.species === 'angel' ? 4 : 1,
      });
    }
    const geo = GEO_CACHE[data.species];
    this.total = geo.total * scale;
    const pals = data.species === 'betta' ? BETTA_PALETTES : GUPPY_PALETTES;
    const pal = pals[(data.palette ?? 0) % pals.length];
    this.u = makeFishUniforms(geo.total, this.sp.pattern, b.length / geo.total, pal[0], pal[1], data.seed ?? Math.random() * 100);
    const mats = makeFishMaterials(this.u);

    this.group = new THREE.Group();
    this.group.scale.setScalar(scale);
    const body = new THREE.Mesh(geo.body, mats.body);
    body.castShadow = true;
    const fins = new THREE.Mesh(geo.fins, mats.fins);
    fins.renderOrder = 7;
    this.group.add(body, fins);
    this.body = body;

    // Gözler: parlak siyah göz bebeği + renkli iris halkası
    const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x020203, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0 });
    const irisCol = { neon: 0x6f8fa8, cory: 0x9a7430, angel: 0xa02818, danio: 0xb0a070 }[data.species] ?? 0x8a8a80;
    const irisMat = new THREE.MeshStandardMaterial({ color: irisCol, metalness: 0.6, roughness: 0.3 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(geo.eye.r, 14, 10), eyeMat);
      e.position.set(s * geo.eye.x, geo.eye.y, geo.eye.z);
      e.scale.set(0.55, 1, 1);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(geo.eye.r * 0.9, geo.eye.r * 0.2, 6, 18), irisMat);
      ring.position.copy(e.position);
      ring.position.x += s * geo.eye.r * 0.18;
      ring.rotation.y = Math.PI / 2;
      this.group.add(e, ring);
    }

    const p = data.pos ?? [0, TANK.water * 0.6, 0];
    this.pos = new THREE.Vector3(...p);
    this.vel = new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2);
    this.fwd = new THREE.Vector3(1, 0, 0).applyAxisAngle(_up, Math.random() * 6.28);
    this.target = new THREE.Vector3();
    this.targetTimer = 0;
    this.state = 'wander';
    this.yawRate = 0;
    this.bend = 0;
    this.flee = 0;
    this.fleeDir = new THREE.Vector3();
    this.airTimer = 40 + Math.random() * 80;
    this.airPhase = 0;
    this.restTimer = 0;
    this.aggroTimer = 3 + Math.random() * 5;
    this.aggro = 0;
    this.prey = null;
    this.pickTarget({ night: 0 });
  }

  get species() { return this.data.species; }
  get radius() { return this.total * 0.5; }

  pickTarget(world) {
    const sp = this.sp;
    const m = 4;
    let x = (Math.random() - 0.5) * (TANK.w - m * 2);
    let z = (Math.random() - 0.5) * (TANK.d - m * 2);
    const floor = sandHeight(x, z);
    let [d0, d1] = sp.depth;
    if (world.night > 0.5) { d0 = Math.max(0, d0 - 0.25); d1 = Math.max(d0 + 0.1, d1 - 0.35); }
    let y = floor + 2 + (TANK.water - 2 - floor - 2) * (d0 + Math.random() * (d1 - d0));
    const trait = this.data.trait;
    if (trait === 'Meraklı' && Math.random() < 0.3 && world.night < 0.5) { z = HALF_D - 3; this.state = 'curious'; }
    if (trait === 'Çekingen' && world.plants?.length && Math.random() < 0.5) {
      const pl = world.plants[Math.floor(Math.random() * world.plants.length)];
      x = pl.x + (Math.random() - 0.5) * 5; z = pl.z + (Math.random() - 0.5) * 4;
    }
    if (sp.bottom) y = sandHeight(x, z) + sp.body.height * 0.55;
    this.target.set(x, y, z);
    this.targetTimer = 4 + Math.random() * 8;
  }

  /** Davranış: her karede. `world` ortak bağlam (diğer canlılar, yem, gece, oksijen...) */
  update(dt, world) {
    const sp = this.sp;
    const d = this.data;
    const pos = this.pos;
    const acc = _v.set(0, 0, 0);
    let speed = sp.cruise * (d.trait === 'Sakin' ? 0.8 : 1);
    let maxTurn = 3.2;
    const night = world.night;

    this.targetTimer -= dt;
    if (this.state !== 'curious' || this.targetTimer < 0) {
      if (pos.distanceTo(this.target) < 2.5 || this.targetTimer < 0) {
        if (this.state === 'curious') this.state = 'wander';
        this.pickTarget(world);
      }
    }

    // --- Durum seçimi (öncelik sırası) ---
    let state = this.state === 'curious' ? 'curious' : 'wander';
    let food = null;
    const hungry = d.hunger > (d.trait === 'Obur' ? 12 : 22);

    if (this.flee > 0) {
      state = 'flee';
      this.flee -= dt;
    } else if (hungry && night < 0.7) {
      food = this.findFood(world);
      if (food) state = 'seek';
    }
    if (state === 'wander' || state === 'curious') {
      if (world.o2 < 32 && !sp.bottom) state = 'air';
      else if (night > 0.6) state = 'sleep';
      else if (sp.school > 0.5 && world.counts[this.species] >= 3) state = 'school';
      else if (d.stress > 60) state = 'hide';
      else if (sp.bottom) state = 'forage';
    }
    // Corydoras: ara sıra yüzeye fırlayıp hava yutar
    if (sp.bottom && state !== 'flee' && state !== 'seek') {
      this.airTimer -= dt;
      if (this.airTimer < 0 && night < 0.5) { this.airPhase = 1; this.airTimer = 60 + Math.random() * 120; world.events.push({ type: 'coryAir', fish: this }); }
      if (this.airPhase > 0) state = 'air';
    }
    // Bölgecilik (beta) ve avlanma (melek balığı)
    if (state !== 'flee' && state !== 'seek' && night < 0.6) {
      this.aggroTimer -= dt;
      if (this.aggro <= 0 && this.aggroTimer < 0) {
        this.aggroTimer = sp.predator ? 18 + Math.random() * 25 : 4 + Math.random() * 6;
        const rule = sp.territorial ?? sp.predator;
        if (rule && (!sp.predator || d.hunger > 30)) {
          let best = null, bd = rule.range;
          for (const o of world.fish) {
            if (o === this || !(rule.targets ?? rule.prey).includes(o.species)) continue;
            const dd = o.pos.distanceTo(pos);
            if (dd < bd) { bd = dd; best = o; }
          }
          if (best) { this.prey = best; this.aggro = sp.predator ? 4 : 3; }
        }
      }
    }
    if (this.aggro > 0 && this.prey && world.fish.includes(this.prey) && state !== 'flee') {
      this.aggro -= dt;
      state = sp.predator ? 'hunt' : this.prey.species === this.species ? 'flare' : 'chase';
    } else { this.aggro = 0; this.prey = null; }
    this.state = state;

    // --- Yönlendirme ---
    const seekTo = (tgt, w = 1) => { _v2.subVectors(tgt, pos); const L = _v2.length(); if (L > 1e-3) acc.addScaledVector(_v2, w / L); };

    switch (state) {
      case 'flee':
        acc.addScaledVector(this.fleeDir, 3);
        speed = sp.burst;
        maxTurn = 9;
        break;
      case 'seek': {
        seekTo(food.pos, 2.2);
        const dist = food.pos.distanceTo(pos);
        speed = Math.min(sp.burst * 0.55, 3 + dist * 1.2);
        maxTurn = 7;
        // ağız (burun) yeme değdi mi
        const mouth = _v2.copy(this.fwd).multiplyScalar(this.total * 0.45).add(pos);
        if (mouth.distanceTo(food.pos) < 0.9 + this.total * 0.1 && !food.eaten) {
          food.eaten = true;
          d.hunger = Math.max(0, d.hunger - 10);
          this.state = 'eat';
          world.events.push({ type: 'eat', fish: this, food });
        }
        break;
      }
      case 'air': {
        if (sp.bottom) {
          const up = this.airPhase === 1;
          _v2.set(pos.x + this.fwd.x * 3, up ? TANK.water - 0.6 : sandHeight(pos.x, pos.z) + 1, pos.z + this.fwd.z * 3);
          seekTo(_v2, 3);
          speed = sp.burst * 0.8;
          maxTurn = 6;
          if (up && pos.y > TANK.water - 1.4) this.airPhase = 2;
          if (!up && pos.y < sandHeight(pos.x, pos.z) + 2.5) this.airPhase = 0;
        } else {
          _v2.set(this.target.x, TANK.water - 1.0, this.target.z);
          seekTo(_v2, 1.5);
          speed = sp.cruise * 0.7;
        }
        break;
      }
      case 'chase':
      case 'flare':
      case 'hunt': {
        const p = this.prey;
        seekTo(p.pos, 2.5);
        const dist = p.pos.distanceTo(pos);
        speed = state === 'flare' ? (dist < 4 ? 0.8 : sp.cruise * 1.5) : sp.burst * (state === 'hunt' ? 0.7 : 0.6);
        maxTurn = 6;
        if (state === 'flare') {
          // iki erkek beta: yüzgeçler gerilir, yan yana gösteriş
          this.u.uFlap.value += dt * 10;
          if (dist < 5 && !this.flared) { this.flared = true; world.events.push({ type: 'flare', fish: this }); }
          if (dist < 4) { p.data.stress = Math.min(100, p.data.stress + dt * 6); d.stress = Math.min(100, d.stress + dt * 3); }
        } else if (dist < 6 && !(p.flee > 0)) p.scare?.(pos, state === 'hunt' ? 1.2 : 0.8);
        if (state === 'chase' && dist < 1.5 && !this.nipped) {
          this.nipped = true;
          p.data.stress = Math.min(100, p.data.stress + 15);
          p.data.health = Math.max(0, p.data.health - 2);
          world.events.push({ type: 'nip', fish: this, target: p });
        }
        if (state === 'hunt' && dist < 1.3 && Math.random() < dt * 2) {
          world.events.push({ type: 'predation', fish: this, target: p });
          d.hunger = Math.max(0, d.hunger - 30);
          this.aggro = 0;
        }
        if (this.aggro <= dt) { this.nipped = false; this.flared = false; }
        break;
      }
      case 'sleep':
        seekTo(this.target, 0.5);
        speed = sp.cruise * 0.18;
        maxTurn = 1;
        break;
      case 'school': {
        const sc = world.school[this.species];
        seekTo(sc.target, 0.55);
        this.boids(world, acc, 1);
        speed = sp.cruise * (0.9 + sc.excite * 0.8);
        break;
      }
      case 'hide':
        seekTo(this.target, 0.8);
        speed = sp.cruise * 1.1;
        break;
      case 'forage': {
        // kısa koşular + duraklamalar
        this.restTimer -= dt;
        if (this.restTimer < 0) { this.restTimer = Math.random() < 0.5 ? 1 + Math.random() * 4 : 1 + Math.random() * 2; this.resting = !this.resting; if (!this.resting) this.pickTarget(world); }
        if (this.resting) { speed = 0.25; this.state = 'rest'; }
        else seekTo(this.target, 1);
        break;
      }
      default:
        seekTo(this.target, 1);
        if (this.state === 'curious' && pos.distanceTo(this.target) < 4) speed = 0.6;
    }

    if (sp.school > 0 && state !== 'school' && state !== 'flee') this.boids(world, acc, sp.school * 0.4);

    // Ayrılma (tüm balıklar)
    for (const o of world.fish) {
      if (o === this) continue;
      _v2.subVectors(pos, o.pos);
      const L = _v2.length();
      const min = (this.total + o.total) * 0.45;
      if (L < min && L > 1e-4) acc.addScaledVector(_v2, (min - L) / (min * L) * 2.5);
    }
    // Engeller (taş, kök, filtre)
    for (const ob of world.obstacles) {
      _v2.subVectors(pos, ob.pos);
      const L = _v2.length();
      const m = ob.r + 2;
      if (L < m && L > 1e-4) acc.addScaledVector(_v2, ((m - L) / m) * 3 / L);
    }
    // Sınırlar
    const floor = sandHeight(pos.x, pos.z);
    const lo = sp.bottom ? floor + sp.body.height * 0.45 : floor + 2;
    const hi = TANK.water - (state === 'air' ? 0.5 : 1.4);
    const edge = (val, min, max, k) => (val < min + k ? (min + k - val) / k : 0) - (val > max - k ? (val - (max - k)) / k : 0);
    acc.x += edge(pos.x, -HALF_W + 1.5, HALF_W - 1.5, 5) * 4;
    acc.z += edge(pos.z, -HALF_D + 1.5, HALF_D - 1.5, 4) * 4;
    acc.y += edge(pos.y, lo, hi, 2.5) * 3;
    // balıklar çoğunlukla yatay yüzer
    if (!sp.bottom && state !== 'air') acc.y *= 0.6;

    // --- Hız ve yön ---
    if (acc.lengthSq() > 1e-6) acc.normalize();
    const desired = _v2.copy(acc).multiplyScalar(speed);
    const accel = state === 'flee' ? 60 : state === 'seek' ? 25 : 8;
    const dv = desired.sub(this.vel);
    const dvl = dv.length();
    if (dvl > accel * dt) dv.multiplyScalar((accel * dt) / dvl);
    this.vel.add(dv);
    pos.addScaledVector(this.vel, dt);
    pos.x = THREE.MathUtils.clamp(pos.x, -HALF_W + 1, HALF_W - 1);
    pos.z = THREE.MathUtils.clamp(pos.z, -HALF_D + 1, HALF_D - 1);
    pos.y = THREE.MathUtils.clamp(pos.y, lo - 0.3, TANK.water - 0.4);

    const spd = this.vel.length();
    if (spd > 0.4) {
      const dir = _x.copy(this.vel).divideScalar(spd);
      // eğim sınırla
      const maxPitch = sp.bottom && state !== 'air' ? 0.25 : 0.6;
      dir.y = THREE.MathUtils.clamp(dir.y, -maxPitch, maxPitch);
      dir.normalize();
      const prevYaw = Math.atan2(this.fwd.x, this.fwd.z);
      const ang = this.fwd.angleTo(dir);
      const t = Math.min(1, (maxTurn * dt) / Math.max(ang, 1e-4));
      this.fwd.lerp(dir, t).normalize();
      let dy = Math.atan2(this.fwd.x, this.fwd.z) - prevYaw;
      if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
      this.yawRate = THREE.MathUtils.lerp(this.yawRate, dy / Math.max(dt, 1e-4), 0.2);
    } else {
      this.yawRate *= 0.9;
      // dururken yatay pozisyona dön
      this.fwd.y *= 0.95; this.fwd.normalize();
    }

    // --- Animasyon parametreleri ---
    const k = Math.min(spd / sp.burst, 1);
    const freq = 5 + spd * 1.5 + (state === 'flee' ? 10 : 0);
    this.u.uPhase.value += dt * freq;
    this.u.uAmp.value = THREE.MathUtils.lerp(this.u.uAmp.value, 0.035 + k * 0.13 + (spd < 0.8 ? 0.01 : 0), 0.1);
    this.bend = THREE.MathUtils.lerp(this.bend, THREE.MathUtils.clamp(-this.yawRate * 0.09, -0.35, 0.35), 0.15);
    this.u.uBend.value = this.bend;
    this.u.uFlap.value += dt * (spd < 1.5 ? 11 : 4);
    this.u.uIch.value = THREE.MathUtils.lerp(this.u.uIch.value, d.ich ?? 0, 0.05);
    this.u.uPale.value = THREE.MathUtils.lerp(this.u.uPale.value, Math.max((100 - d.health) / 100, d.stress / 160), 0.05);

    // Dönüşüm
    _y.copy(_up);
    _x.crossVectors(_y, this.fwd).normalize();
    _y.crossVectors(this.fwd, _x).normalize();
    _m.makeBasis(_x, _y, this.fwd);
    _q.setFromRotationMatrix(_m);
    // dönüşlerde hafif yatma
    const roll = THREE.MathUtils.clamp(this.yawRate * 0.08, -0.4, 0.4);
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    this.group.quaternion.slerp(_q, 0.5);
    this.group.position.copy(pos);
  }

  boids(world, acc, w) {
    const pos = this.pos;
    let n = 0;
    const coh = new THREE.Vector3(), ali = new THREE.Vector3();
    for (const o of world.fish) {
      if (o === this || o.species !== this.species) continue;
      const L = o.pos.distanceTo(pos);
      if (L > 10) continue;
      coh.add(o.pos); ali.add(o.vel); n++;
    }
    if (!n) return;
    coh.divideScalar(n).sub(pos);
    acc.addScaledVector(coh, 0.12 * w);
    if (ali.lengthSq() > 0) acc.addScaledVector(ali.normalize(), 0.9 * w);
  }

  findFood(world) {
    let best = null, bd = 40;
    for (const f of world.food) {
      if (f.eaten) continue;
      if (this.sp.bottom ? f.pos.y > 8 : f.state === 'settled') continue;
      const d = f.pos.distanceTo(this.pos);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  scare(from, strength = 1) {
    const d = this.pos.distanceTo(from);
    if (d > 30) return;
    this.flee = 0.8 + Math.random() * 0.8;
    this.fleeDir.subVectors(this.pos, from).normalize();
    this.fleeDir.y += (Math.random() - 0.5) * 0.5;
    this.fleeDir.z -= 0.6; // camdan uzaklaş
    this.fleeDir.normalize();
    const k = this.data.trait === 'Çekingen' ? 1.6 : this.data.trait === 'Sakin' ? 0.6 : 1;
    this.data.stress = Math.min(100, this.data.stress + 7 * k * strength * (1 - d / 30));
  }

  serialize() {
    this.data.pos = [this.pos.x, this.pos.y, this.pos.z].map((v) => Math.round(v * 10) / 10);
    return this.data;
  }

  dispose() {
    this.group.traverse((o) => { if (o.material) o.material.dispose?.(); });
  }
}
