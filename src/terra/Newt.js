import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Japon kırmızı karınlı semenderi (Cynops pyrrhogaster), ffish.asia CC0 taraması.
// Modeldeki tek animasyon bir solucan yeme sahnesi; yürüme, yüzme, nefes ve av hareketleri
// burada iskelet kemikleri doğrudan döndürülerek üretilir.

const LENGTH = 11;                 // burun-kuyruk ucu (cm)
const MODEL_LEN = 8.6;             // modelin kendi birimiyle boyu
const S = LENGTH / MODEL_LEN;
const FOOT_Y = 0.62;               // gövde yere yakın: dirsekler yana açık, karın neredeyse yere değer
const TRUNK_MID = -0.2;            // dönüş ekseni: gövde ortası (model x)
const SPRAWL = 0.32;               // semenderin yayvan duruşu: üst kol/uyluk yataya yakın

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

export const NEWT_LABEL = {
  rest: 'Dinleniyor', walk: 'Geziniyor', swim: 'Yüzüyor', air: 'Yüzeyden hava alıyor', stalk: 'Avına yaklaşıyor',
  strike: 'Avını yakaladı', swallow: 'Yutuyor', hide: 'Kabuğun altında saklanıyor',
};

export class Newt {
  constructor(world, data = {}) {
    this.world = world;
    this.data = { name: 'Beni', hunger: 30, size: 0.8, adultSize: 1, ...data };
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
    const m = this.mesh.material;
    m.roughness = 0.42;
    m.metalness = 0;
    if ('clearcoat' in m) { m.clearcoat = 0.3; m.clearcoatRoughness = 0.5; }

    const p = data.pos ?? [0, 0, 0];
    this.pos = new THREE.Vector3(...p);
    this.heading = data.heading ?? Math.random() * Math.PI * 2;
    this.speed = 0;
    this.vy = 0;
    this.phase = 0;          // yürüme döngüsü 0..1
    this.swimPhase = 0;
    this.swimBlend = world.depthAt(this.pos.x, this.pos.z) > 1.5 ? 1 : 0;
    this.state = 'rest';
    this.timer = 3 + Math.random() * 5;
    this.target = new THREE.Vector3();
    this.look = { yaw: 0, pitch: 0, tyaw: 0, tpitch: 0, timer: 1 };
    this.jaw = 0;
    this.strikeT = 0;
    this.airTimer = 60 + Math.random() * 120;
    this.breath = Math.random() * 10;
    this.pitch = 0;
    this.roll = 0;
    this.bendSmooth = 0;
    this.prey = null;
    this.constrain();
    this.place();
  }

  serialize() {
    return { ...this.data, pos: this.pos.toArray().map((v) => +v.toFixed(2)), heading: +this.heading.toFixed(3) };
  }

  get inWater() { return this.swimBlend > 0.5; }

  // ---------------------------------------------------------------- Davranış
  pickTarget(preferWater) {
    const w = this.world;
    for (let k = 0; k < 30; k++) {
      const x = (Math.random() - 0.5) * (w.w - 18), z = (Math.random() - 0.5) * (w.d - 16);
      const deep = w.depthAt(x, z) > 2;
      if (preferWater !== undefined && deep !== preferWater) continue;
      if (w.blocked(x, z, 3)) continue;
      this.target.set(x, 0, z);
      return;
    }
    this.target.set(0, 0, 0);
  }

  think(dt) {
    const w = this.world;
    const d = this.data;
    this.timer -= dt;
    if (this.inWater) this.airTimer -= dt;

    // Av: hareket eden solucanı fark et (suda koku, karada görme ile)
    if (!this.prey && d.hunger > 15 && !['strike', 'swallow', 'air'].includes(this.state)) {
      let best = null, bd = 28;
      for (const f of w.food) {
        if (f.eaten || f.claimed) continue;
        const dist = Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z);
        if (dist < bd) { bd = dist; best = f; }
      }
      if (best) { this.prey = best; best.claimed = true; this.state = 'stalk'; }
    }

    switch (this.state) {
      case 'rest':
      case 'hide':
        if (this.timer < 0) {
          const night = w.night;
          const goWater = Math.random() < (night ? 0.55 : 0.35);
          this.pickTarget(goWater);
          this.state = 'walk';
          this.timer = 40;
        }
        break;
      case 'walk':
      case 'swim': {
        this.state = this.inWater ? 'swim' : 'walk';
        const dist = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
        if (this.inWater && this.airTimer < 0) { this.state = 'air'; this.timer = 12; break; }
        if (dist < 2.2 || this.timer < 0) {
          const nearHide = w.hide && this.pos.distanceTo(w.hide) < 6;
          this.state = nearHide && !w.night ? 'hide' : 'rest';
          this.timer = this.inWater ? 3 + Math.random() * 6 : 6 + Math.random() * 14;
          if (Math.random() < 0.25 && !w.night && !this.inWater && w.hide) {
            this.target.copy(w.hide); this.state = 'walk'; this.timer = 40;
          }
        }
        break;
      }
      case 'air':
        if (this.timer < 0) { this.airTimer = 90 + Math.random() * 150; this.pickTarget(); this.state = 'swim'; this.timer = 30; }
        break;
      case 'stalk': {
        const f = this.prey;
        if (!f || f.eaten) { this.prey = null; this.state = 'rest'; this.timer = 2; break; }
        this.target.copy(f.pos);
        const head = this.headPos(_w);
        const dist = Math.hypot(f.pos.x - head.x, f.pos.z - head.z);
        const ang = Math.abs(wrap(Math.atan2(f.pos.x - this.pos.x, f.pos.z - this.pos.z) - this.heading));
        // son yaklaşma: dur, başını hedefe çevir, sonra ani atak
        if (dist < 1.6 && ang < 0.35) { this.state = 'strike'; this.strikeT = 0; }
        break;
      }
      case 'strike':
        this.strikeT += dt;
        if (this.strikeT > 0.12 && this.prey && !this.prey.eaten) { this.prey.eaten = true; this.world.eat(this.prey); }
        if (this.strikeT > 0.45) { this.state = 'swallow'; this.timer = 2.4; d.hunger = Math.max(0, d.hunger - 35); }
        break;
      case 'swallow':
        if (this.timer < 0) { this.prey = null; this.state = 'rest'; this.timer = 4 + Math.random() * 4; }
        break;
    }
  }

  headPos(out) {
    const k = 4.4 * this.data.size;
    return out.set(this.pos.x + Math.sin(this.heading) * k, this.pos.y + 0.6 * this.data.size, this.pos.z + Math.cos(this.heading) * k);
  }

  // ---------------------------------------------------------------- Hareket
  update(dt) {
    dt = Math.min(dt, 0.05);
    const w = this.world;
    const d0 = this.data;
    d0.hunger = Math.min(100, d0.hunger + dt * 0.02);
    // çok yavaş büyüme (1 sn = 1 oyun dakikası): tokken birkaç oyun haftasında yetişkin boyuna ulaşır
    if (d0.size < d0.adultSize && d0.hunger < 60) d0.size = Math.min(d0.adultSize, d0.size + (d0.adultSize - d0.size) * 0.004 * dt / 60);
    this.root.scale.setScalar(d0.size);
    this.think(dt);

    const depth = w.depthAt(this.pos.x, this.pos.z);
    this.swimBlend += ((depth > 1.6 ? 1 : depth < 0.9 ? 0 : this.swimBlend) - this.swimBlend) * Math.min(1, dt * 2.5);

    // hedef hız ve yön
    let want = 0;
    const st = this.state;
    const tx = this.target.x - this.pos.x, tz = this.target.z - this.pos.z;
    let turnTo = Math.atan2(tx, tz);
    if (st === 'walk') want = 1.7;
    else if (st === 'swim') want = 4.5;
    else if (st === 'stalk') {
      const dist = Math.hypot(tx, tz);
      want = this.inWater ? Math.min(3, dist * 0.8) : Math.min(1.3, dist * 0.5);
      if (dist < 6 && dist > 4.2) want *= 0.35;            // dikkatle süzülerek yaklaşma
    } else if (st === 'air') want = this.pos.y > w.waterY - 1.2 ? 0 : 1.2;
    else if (st === 'strike') want = this.strikeT < 0.15 ? 9 : 0;

    // engellerden ve camdan kaçınma
    const ahead = _v.set(this.pos.x + Math.sin(this.heading) * 4, 0, this.pos.z + Math.cos(this.heading) * 4);
    if (w.blocked(ahead.x, ahead.z, 1) && st !== 'strike') turnTo = this.heading + 1.2;
    const err = wrap(turnTo - this.heading);
    const turnRate = this.inWater ? 1.8 : 0.9;
    const h0 = this.heading;
    if (want > 0 || st === 'stalk') this.heading += THREE.MathUtils.clamp(err, -turnRate * dt, turnRate * dt);
    // yerinde dönerken de ayaklar adım atar: dönüş hızını yürüme hızına çevir (ayak kayması olmasın)
    this.yawRate = (this.heading - h0) / Math.max(dt, 1e-4);
    if (Math.abs(err) > 1.2 && st !== 'strike') want *= 0.25;   // önce yerinde dön
    this.speed += (want - this.speed) * Math.min(1, dt * (st === 'strike' ? 20 : this.inWater ? 1.5 : 3));

    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    this.constrain();

    // yükseklik: karada zemine bas, suda yüz
    const ground = w.ground(this.pos.x, this.pos.z);
    if (this.swimBlend > 0.5) {
      let ty = THREE.MathUtils.clamp(ground + 1.5 + Math.sin(this.swimPhase * 0.13) * 0.6, ground + 0.4, w.waterY - 1.1);
      if (st === 'air') ty = w.waterY - 0.55;
      if (st === 'rest' || st === 'hide') ty = ground + 0.05;       // dipte dinlenir
      this.vy += ((ty - this.pos.y) * 2 - this.vy) * Math.min(1, dt * 2);
      this.pos.y += this.vy * dt;
      this.pos.y = Math.max(this.pos.y, ground);
    } else {
      this.pos.y += (ground - this.pos.y) * Math.min(1, dt * 12);
      this.vy = 0;
    }

    // eğim: karada zeminin eğimi, suda dikey hız / yüzeye uzanma
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const slope = Math.atan2(w.ground(this.pos.x + fx * 2.5, this.pos.z + fz * 2.5) - w.ground(this.pos.x - fx * 2.5, this.pos.z - fz * 2.5), 5);
    let tp = this.swimBlend > 0.5 ? THREE.MathUtils.clamp(-this.vy * 0.12, -0.5, 0.5) : -slope;
    if (st === 'air') tp = -0.75;
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 3);
    const lx = -fz, lz = fx;
    const side = Math.atan2(w.ground(this.pos.x + lx * 1.2, this.pos.z + lz * 1.2) - w.ground(this.pos.x - lx * 1.2, this.pos.z - lz * 1.2), 2.4);
    this.roll += ((this.swimBlend > 0.5 ? 0 : side) - this.roll) * Math.min(1, dt * 4);

    this.animate(dt);
    this.place();
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
        for (const o of w.obstacles) {
          if (o.top) continue;
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
    const STRIDE = 2.4;   // bir döngüde alınan yol (cm): duruş evresinde ayağın geriye kaydığı yol / duty
    const gait = Math.max(Math.abs(this.speed), Math.abs(this.yawRate ?? 0) * 2.2);
    const f = gait / STRIDE;
    this.phase = (this.phase + f * dt * lb) % 1;
    const moving = THREE.MathUtils.clamp(gait / 1.2, 0, 1) * lb;
    const duty = 0.68, A = 0.8, LIFT = 0.45;
    const p2 = this.phase * Math.PI * 2;

    // --- yüzme: kuyruktan geriye akan dalga, bacaklar gövdeye yapışık
    const swimF = 0.6 + Math.abs(this.speed) * 0.35 + (st === 'air' ? 0.6 : 0);
    this.swimPhase += swimF * dt * Math.PI * 2 * Math.max(sb, 0.001);
    const swimAmp = sb * (st === 'rest' || st === 'hide' ? 0.15 : 0.35 + Math.min(this.speed, 5) * 0.06);

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
    const turn = THREE.MathUtils.clamp(wrap(Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z) - this.heading), -1, 1) * (this.speed > 0.2 ? 0.035 : 0.02);
    this.bendSmooth += (turn - this.bendSmooth) * Math.min(1, dt * 3);
    TRUNK.forEach((n, i) => { if (i) j[n].rot(UP, trunkAngles[i] - this.bendSmooth); });
    // omuz kuşağı kökte: gövde orta hattı düz kalsın diye yarısını geri çevir
    const rootYaw = -total * 0.5 + this.bendSmooth * 3;
    j[TRUNK[0]].rot(UP, rootYaw);

    // kuyruk: karada sürüklenip hafifçe salınır, suda asıl itici
    TAIL.forEach((n, i) => {
      const t = (i + 1) / TAIL.length;
      const land = moving * 0.06 * Math.sin(p2 - 1.2 - t * 2.2) + 0.02 * Math.sin(this.breath * 0.4 + t * 3) * lb;
      const water = swimAmp * (0.25 + t * 0.9) * Math.sin(this.swimPhase - 1.6 - t * 3.2) * 0.42;
      j[n].rot(UP, land + water - this.bendSmooth * 0.6);
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
    this.breath += dt;
    const lk = this.look;
    lk.timer -= dt;
    if (lk.timer < 0) {
      lk.timer = 1.5 + Math.random() * 4;
      const idle = st === 'rest' || st === 'hide';
      lk.tyaw = idle ? (Math.random() - 0.5) * 0.7 : (Math.random() - 0.5) * 0.25;
      lk.tpitch = idle ? (Math.random() - 0.4) * 0.25 : 0;
    }
    if (this.prey && (st === 'stalk' || st === 'strike')) {
      const a = wrap(Math.atan2(this.prey.pos.x - this.pos.x, this.prey.pos.z - this.pos.z) - this.heading);
      lk.tyaw = THREE.MathUtils.clamp(a, -0.6, 0.6);
      lk.tpitch = this.inWater ? 0 : 0.2;
    }
    // bakış ani değil: semender başını yavaş, kesik kesik çevirir
    lk.yaw += (lk.tyaw - lk.yaw) * Math.min(1, dt * 2.2);
    lk.pitch += (lk.tpitch - lk.pitch) * Math.min(1, dt * 2.2);
    const head = j.Bone019_129;
    head.rot(UP, rootYaw * 0.8 + lk.yaw);
    let strikeDip = 0;
    if (st === 'strike') {
      const s = this.strikeT;
      strikeDip = s < 0.12 ? s / 0.12 : Math.max(0, 1 - (s - 0.12) / 0.3);
    }
    head.rot(LAT, -(lk.pitch + strikeDip * 0.35) + (st === 'air' ? 0.25 : 0));

    // çene: avda açılıp kapanır, yutarken yutkunur, yüzeyde hava yutar; gırtlak pompası sürekli
    let jaw = 0.012 * (0.5 + 0.5 * Math.sin(this.breath * 9));            // bukkal pompalama
    if (st === 'strike') jaw = this.strikeT < 0.1 ? 0.32 * (this.strikeT / 0.1) : Math.max(0, 0.32 - (this.strikeT - 0.1) * 3);
    if (st === 'swallow') jaw = Math.max(0, Math.sin((2.4 - this.timer) * 5)) * 0.05;
    if (st === 'air' && this.pos.y > this.world.waterY - 0.8) jaw = Math.max(0, Math.sin(this.breath * 3)) * 0.22;
    this.jaw += (jaw - this.jaw) * Math.min(1, dt * 25);
    j.Bone020_120.rot(LAT, -this.jaw);
  }
}
