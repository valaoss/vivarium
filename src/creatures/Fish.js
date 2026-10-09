import * as THREE from 'three';
import { TANK, HALF_W, HALF_D } from '../config.js';
import { SPECIES } from './species.js';
import { buildFish } from './fishGeometry.js';
import { makeFishMaterials, makeFishUniforms } from './fishMaterial.js';
import { makeRealFishMeshes, realModelKey, REAL_FISH, findMouth } from './realModels.js';
import { sandHeight } from '../world/substrate.js';
import { encounterTime } from './motion.js';
import { waterCurrent } from '../render/water.js';
import { Agent } from '../eco/Agent.js';
import { Brain } from '../eco/Brain.js';
import { FISH_ACTIONS, FISH_PROFILES, zonePoint } from './fishBrain.js';
import { SwimDrive, Drift, heavyTail, steerRate } from '../eco/locomotion.js';

const GEO_CACHE = {};
const BETTA_PALETTES = [
  [0x8a0410, 0x2050ff], [0x10209a, 0x30d0ff], [0xb01030, 0xffffff], [0x3a0a6a, 0xff3090], [0xd04008, 0xffd040],
];
const GUPPY_PALETTES = [
  [0xff6a1a, 0x2a5cff], [0xff2a3a, 0xffb020], [0x2fa8ff, 0x9a3cff], [0xffd23a, 0xff3a2a], [0x18d6a0, 0x1f5cff], [0xff5aa0, 0xffd0e0],
];

const _wc = new THREE.Vector3(), _ax = new THREE.Vector3();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _q = new THREE.Quaternion(), _mw = new THREE.Vector3(), _fd = new THREE.Vector3();
const _b1 = new THREE.Vector3(), _b2 = new THREE.Vector3(), _b3 = new THREE.Vector3();
// hassas konumlanma gereken durumlarda (yem, hava, yosun, eşeleme) doğrudan hız denetimi; geri kalanında itki fiziği
const PRECISE = new Set(['seek', 'eat', 'air', 'graze', 'root']);

// Yüzme tarzı: burst = kuyruk vuruşu + süzülme (danio, tetra), steady = sürekli,
// hover = yavaş, yerinde asılı kalabilen (beta, melek), eel = yılan gibi (kuhli), hop = tabanda zıplayıp durma
const GAIT = {
  neon: 'burst', cardinal: 'burst', danio: 'burst', rasbora: 'burst', barb: 'burst',
  guppy: 'steady', platy: 'steady', molly: 'steady', swordtail: 'steady',
  betta: 'hover', gourami: 'hover', angel: 'hover',
  kuhli: 'eel', cory: 'hop', oto: 'hop',
};

export const STATE_LABEL = {
  wander: 'Dolaşıyor', school: 'Sürüyle yüzüyor', seek: 'Yem arıyor', eat: 'Yiyor', flee: 'Kaçıyor',
  sleep: 'Uyuyor', air: 'Yüzeyden hava alıyor', hide: 'Saklanıyor', forage: 'Kumu eşeliyor', curious: 'Seni izliyor', rest: 'Dinleniyor',
  chase: 'Rakibini kovalıyor', flare: 'Yüzgeçlerini açıp gösteriş yapıyor', hunt: 'Avlanıyor',
  root: 'Kumu eşeliyor', graze: 'Yosun kazıyor', wait: 'Yem bekliyor', court: 'Kur yapıyor', nest: 'Köpük yuvası yapıyor',
};

export class Fish extends Agent {
  constructor(data, eco) {
    super(eco, { species: data.species, seed: (data.seed ?? Math.random() * 100) * 1e6 + (data.id ?? 0) % 1e6, thinkInterval: 0.3 });
    this.kind = 'fish';
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
        ventral: { angel: 4, gourami: 5.5 }[data.species] ?? 1,
      });
    }
    const geo = GEO_CACHE[data.species];
    this.baseTotal = geo.total;
    this.total = geo.total * scale;
    const pals = this.sp.colors ?? (data.species === 'betta' ? BETTA_PALETTES : GUPPY_PALETTES);
    const pal = pals[(data.palette ?? 0) % pals.length];
    this.u = makeFishUniforms(geo.total, this.sp.pattern, b.length / geo.total, pal[0], pal[1], data.seed ?? Math.random() * 100);
    this.group = new THREE.Group();
    this.group.scale.setScalar(scale);
    const realKey = realModelKey(data.species, data.sex);
    if (realKey) {
      // Gerçek 3D model (Sketchfab)
      const meshes = makeRealFishMeshes(realKey, this.u);
      this.group.add(...meshes);
      this.body = meshes[0];
    } else {
      const mats = makeFishMaterials(this.u);
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
    }

    // Ağız ucu (yerel): yem buraya çekilir
    if (realKey) this.mouthLocal = REAL_FISH[realKey].mouth.clone();
    else this.mouthLocal = (geo.mouth ??= findMouth(geo.body, geo.total)).clone();
    this.u.uMouthY.value = this.mouthLocal.y;
    this.mouthOpen = 0;
    this.gill = 0;
    this.breath = this.rand() * Math.PI * 2;
    this.breathRate = 0.75 + this.rand() * 0.5;
    this.motionPhase = this.rand() * Math.PI * 2;
    this.feed = null;
    this.gait = GAIT[data.species] ?? 'steady';
    this.u.uEel.value = this.gait === 'eel' ? 1 : 0;
    this.thrust = 1;
    this.cstart = 0;
    this.cside = 1;
    this.wasFleeing = false;
    // itki ile yüzme ve bireysel tempo: her balık kendi hızında, yönü ve hızı yavaşça kayar, arada durur
    this.drive = new SwimDrive({ cruise: this.sp.cruise, burst: this.sp.burst, gait: { hop: 'burst', eel: 'steady' }[this.gait] ?? this.gait, rand: this.rand, glideTau: this.gait === 'hop' ? 0.35 : 0.9 });
    this.slip = new THREE.Vector3();
    this.turnW = 0;
    this.pers = { pace: 0.85 + this.rand() * 0.3, wander: 0.6 + this.rand() * 0.8, pauser: { hover: 0.55, steady: 0.3, burst: 0.12 }[this.gait] ?? 0.2 };
    this.paceDrift = new Drift(this.rand, 4, 1);
    this.yawDrift = new Drift(this.rand, 2.5, 1);
    this.pitchDrift = new Drift(this.rand, 3, 1);
    this.pauseT = heavyTail(this.rand, 3, 40);
    this.paused = false;
    this.relay = null;
    this.fleeAge = 9;

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
    this.prey = null;
    // bağımsız ajan: tür profili, algı ve karar
    this.prof = FISH_PROFILES[data.species] ?? {};
    this.label = this.sp.name;
    this.brain = new Brain(FISH_ACTIONS);
    this.world = { night: 0, plants: [], fish: [], food: [], o2: 80, events: [], algae: 0, hour: 12 };
    this.goal = zonePoint(this, new THREE.Vector3());
    this.alarm = 0;
    this.airNeed = Math.random();
    this.mates = [];
    this.food = null;
    this.knownFood = new WeakSet();
    if (data.feedSpot) this.remember('feedSpot', new THREE.Vector3(...data.feedSpot), 2, 8);
    data.feedHours ??= new Array(24).fill(0);
  }

  get size() { return this.total; }
  get speed() { return this.vel.length(); }
  feedLocked() { const fe = this.feed; return !!fe && (fe.phase === 'hold' || fe.phase === 'spit' || fe.phase === 'strike'); }

  // ---------------------------------------------------------------- algı (ışık, bulanıklık, yan çizgi, koku)
  sense(dt) {
    const w = this.world, sp = this.sp, P = this.prof, pos = this.pos;
    this.forget(dt, 0.002);
    const light = 1 - w.night * 0.78;
    const clear = 1 - (w.turbidity ?? 0) * 0.6;
    const R = Math.max(6, 32 * light * clear);
    this.visR = R;
    const seen = (p, r = R) => {
      _v.subVectors(p, pos); const d = _v.length();
      return d < r && (d < 2 || _v.dot(this.fwd) / d > -0.75);          // arkada küçük kör alan
    };
    // yan çizgi: yüzeye düşen yem / ani hareket
    let cue = null;
    for (const v of this.eco.vib) {
      if (v.src === this || v.medium !== 'water' || this.eco.time - v.t > 0.8) continue;
      const d = v.pos.distanceTo(pos);
      if (v.amp * Math.exp(-d / 9) > 0.12) { cue = v.pos; if (v.kind === 'food') this.perceive(null, 'yan çizgi', v.pos, 0.6, { food: true }); }
    }
    // yem: görerek, dipte koklayarak, sürü arkadaşının yem kaptığını görerek
    const mates = [];
    for (const o of w.fish) {
      if (o === this || o.species !== this.species || !o.pos) continue;
      if (seen(o.pos, Math.min(R, 18))) mates.push(o);
    }
    this.mates = mates;
    // ürkme dalgası: yeni kaçmaya başlayan bir sürü arkadaşını görünce kısa bir tepki gecikmesiyle o da kaçar
    if (!(this.flee > 0) && !this.relay) {
      for (const m of mates) {
        if (!(m.flee > 0) || m.fleeAge > 0.4 || (m.scareLvl ?? 1) < 0.3) continue;
        this.relay = { t: 0.06 + this.rand() * 0.22, from: m.pos.clone().addScaledVector(m.fleeDir, -4), lvl: (m.scareLvl ?? 1) * 0.75 };
        break;
      }
    }
    let best = null, bd = Infinity, how = '';
    for (const f of w.food) {
      if (f.eaten || (f.held && f.held !== this)) continue;
      if (sp.bottom ? f.pos.y > sandHeight(f.pos.x, f.pos.z) + 8 : f.state === 'settled') continue;
      const d = f.pos.distanceTo(pos);
      let h = '';
      if (P.bottomFeeder && f.state === 'settled' && d < 14) h = 'dipteki yemin kokusunu aldı';
      else if (seen(f.pos, f.state === 'settled' ? R * 0.5 : R)) h = f.state === 'float' ? 'yüzeydeki pulu gördü' : 'batan yemi gördü';
      else if (cue && f.pos.distanceTo(cue) < 6 && d < 22) h = 'suya düşen yemin titreşimini hissetti';
      else if (mates.some((m) => (m.state === 'seek' || m.state === 'eat') && m.pos.distanceTo(f.pos) < 8)) h = 'sürü arkadaşının yem kaptığını gördü';
      if (!h) continue;
      const sc = d * (this.knownFood.has(f) ? 0.8 : 1);
      if (sc < bd) { bd = sc; best = f; how = h; }
    }
    if (best && !this.knownFood.has(best)) {
      this.knownFood.add(best);
      if (best.age !== undefined && best.age < 20) this.learnFeeding(best.pos);
    }
    this.food = best ? { item: best, how } : null;
    if (best) this.perceive(null, how.includes('koku') ? 'koku' : how.includes('titreşim') ? 'yan çizgi' : 'görme', best.pos, 0.9, { food: true, why: how });

    // diğer balıklar: rakip, eş, av, tehdit
    this.rival = null; this.mate = null; this.quarry = null; this.threat = null;
    let rb = Infinity, mb = Infinity, qb = Infinity;
    for (const o of w.fish) {
      if (o === this || !o.sp || !seen(o.pos)) continue;
      const d = o.pos.distanceTo(pos);
      if (P.territorial && !(this.rivalCooldown > 0) && !o.data.fry && d < 12 && d < rb && (o.species === this.species && o.data.sex !== 'f' || ['guppy', 'gourami'].includes(o.species))) {
        rb = d; this.rival = { e: o, pos: o.pos, conf: 1 - d / 14, why: 'rakip' };
      }
      if ((P.court || P.dawnChase) && this.data.sex === 'm' && !(this.courtCooldown > 0) && o.species === this.species && o.data.sex === 'f' && !o.data.fry && d < 15 && d < mb) {
        mb = d; this.mate = { e: o, conf: 1 - d / 16 };
      }
      if (P.predator && (P.predator.prey.includes(o.species) || (o.data.fry && o.species !== this.species)) && o.total < this.total * (P.predator.ratio + 0.3) && d < 14 && d < qb) {
        qb = d; this.quarry = { e: o, conf: 1 - d / 15 };
      }
      // küçük balık için: ağzına sığabileceği büyüklükte avcı yakında
      const pp = FISH_PROFILES[o.species]?.predator;
      if (pp && pp.prey.includes(this.species) && d < 10) {
        const lvl = (1 - d / 10) * (o.state === 'hunt' ? 1 : 0.4);
        if (lvl > this.alarm) { this.alarm = lvl; this.threat = { e: o, pos: o.pos, why: `${o.sp.name} yakında: avcı`, lvl }; }
      }
    }
    // betanın aynası: aydınlıkta yan / ön cama yakın ve cama dönükken kendi yansımasını görür
    if (P.mirror && !this.rival && !(this.rivalCooldown > 0) && light > 0.6) {
      const gx = HALF_W - Math.abs(pos.x), gz = HALF_D - Math.abs(pos.z);
      const toward = gx < gz ? Math.sign(pos.x) * this.fwd.x : Math.sign(pos.z) * this.fwd.z;
      if (Math.min(gx, gz) < 6 && toward > 0.25) {
        const mp = gx < gz ? new THREE.Vector3(Math.sign(pos.x) * HALF_W, pos.y, pos.z) : new THREE.Vector3(pos.x, pos.y, Math.sign(pos.z) * HALF_D);
        this.rival = { e: this, pos: mp, conf: 0.8, mirror: true, why: 'yansıma' };
      }
    }
    if (this.rival && !this.rival.mirror) this.perceive(this.rival.e, 'görme', this.rival.e.pos, this.rival.conf, {}).role = 'rakip';
    if (this.mate) this.perceive(this.mate.e, 'görme', this.mate.e.pos, this.mate.conf, {}).role = 'eş';
    if (this.quarry) this.perceive(this.quarry.e, 'görme', this.quarry.e.pos, this.quarry.conf, {}).role = 'av';
    if (this.threat) { this.perceive(this.threat.e, 'görme', this.threat.e.pos, this.threat.lvl, {}).role = 'tehdit'; this.remember('danger', this.threat.pos, this.threat.lvl, 6); }
    for (const p of this.percepts.values()) { p.dist = p.pos.distanceTo(pos); if (p.info.food) { p.role = 'yem'; p.why = p.info.why ?? 'yem'; } }
  }

  learnFeeding(at) {
    const H = this.data.feedHours;
    const h = Math.floor(this.world.hour ?? 12);
    for (let i = 0; i < 24; i++) H[i] *= 0.97;
    H[h] += 1;
    this.remember('feedSpot', new THREE.Vector3(at.x, Math.min(at.y, TANK.water - 2.5), at.z), 1, 8);
    const m = this.recall('feedSpot');
    if (m) this.data.feedSpot = m.pos.toArray().map((v) => +v.toFixed(1));
  }
  feedExpectation() {
    const H = this.data.feedHours;
    const tot = H.reduce((a, b) => a + b, 0);
    if (tot < 2 || !this.recall('feedSpot')) return 0;
    const hr = this.world.hour ?? 12, h = Math.floor(hr) % 24, nx = (h + 1) % 24;
    return Math.min(1, (H[h] * 0.6 + H[nx] * (hr - h)) / (tot * 0.3));
  }

  inspect() {
    const o = super.inspect();
    const d = this.data;
    o.meta = [
      `${d.sex === 'm' ? 'Erkek' : 'Dişi'} · ${(this.sp.body.length * (d.size ?? 1)).toFixed(1)} cm · ${d.trait} · ${d.ageDays !== undefined ? `${Math.floor(d.ageDays)} günlük${this.elder ? ' (yaşlı)' : d.fry ? ' (yavru)' : ''} · ` : ''}görüş ${this.visR?.toFixed(0) ?? '?'} cm`,
      `${this.mates.length} hemcinsini görüyor${this.prof.air ? ` · hava ihtiyacı %${Math.round(Math.min(1, this.airNeed) * 100)}` : ''}${this.nestSize ? ` · yuva %${Math.round(this.nestSize / 1.5 * 100)}` : ''} · yem beklentisi %${Math.round(this.feedExpectation() * 100)}`,
    ];
    o.bars = [['Tokluk', 100 - d.hunger, d.hunger > 70], ['Stres', d.stress, d.stress > 60], ['Sağlık', d.health, d.health < 50], ['Tedirginlik', this.alarm * 100, this.alarm > 0.5]];
    return o;
  }

  get species() { return this.data.species; }
  get radius() { return this.total * 0.5; }

  pickTarget(world) {
    // eski çağrılar için: tür bölgesinde yeni hedef
    zonePoint(this, this.target);
    this.targetTimer = 4 + Math.random() * 8;
    if (world) return;
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
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const sp = this.sp;
    const d = this.data;
    const pos = this.pos;
    const acc = _v.set(0, 0, 0);
    let speed = sp.cruise * (d.trait === 'Sakin' ? 0.8 : 1);
    let maxTurn = 3.2;
    // gececi türler (kuhli) gündüz saklanır, gece aktiftir
    const night = sp.nocturnal ? Math.max(0, 1 - world.night * 1.5) * 0.9 : world.night;

    this.world = world;
    this.alarm = Math.max(0, this.alarm - dt * 0.25);
    this.rivalCooldown = (this.rivalCooldown ?? 0) - dt;
    this.courtCooldown = (this.courtCooldown ?? 0) - dt;
    this.grazeRest = (this.grazeRest ?? 0) - dt;
    const P = this.prof;
    if (P.air) this.airNeed += dt / (P.air === 'gut' ? 100 : P.air === 'labyrinth' ? (this.species === 'betta' ? 26 : 38) : 60) * (world.o2 < 40 ? 2 : 1);
    if (this.flee > 0) this.flee -= dt;
    this.fleeAge += dt;
    if (this.relay && (this.relay.t -= dt) <= 0) { const r = this.relay; this.relay = null; this.scare(r.from, r.lvl, 'sürü arkadaşı ürktü'); }
    // algı + karar: her karede değil, kısa aralıklarla (her balık kendi ritminde)
    this.thinkAcc = (this.thinkAcc ?? Math.random() * this.thinkInterval) + dt;
    if (this.thinkAcc >= this.thinkInterval) { this.sense(this.thinkAcc); this.decayPercepts(this.thinkAcc); this.brain.decide(this); this.thinkAcc = 0; }
    this.mouthTarget = 0;
    this.gillTarget = 0;
    this.quiver = 0;
    this.faceDir = null;
    this.brain.tick(this, dt);
    const state = this.state;
    const food = this.foodTarget;
    if (this.feed && state !== 'seek' && state !== 'eat') this.feed = null;

    // --- Yönlendirme ---
    const seekTo = (tgt, w = 1) => { _v2.subVectors(tgt, pos); const L = _v2.length(); if (L > 1e-3) acc.addScaledVector(_v2, w / L); };

    switch (state) {
      case 'flee':
        acc.addScaledVector(this.fleeDir, 3);
        speed = sp.burst;
        maxTurn = 9;
        break;
      case 'seek': {
        this.updateFeeding(dt, world, food, seekTo);
        speed = this.feedSpeed; maxTurn = this.feedTurn;
        break;
      }
      case 'eat': {
        this.updateFeeding(dt, world, null, seekTo);
        speed = this.feedSpeed; maxTurn = this.feedTurn;
        break;
      }
      case 'air': {
        if (P.air === 'gut') {
          const up = this.airPhase === 1;
          _v2.set(pos.x + this.fwd.x * 3, up ? TANK.water - 0.6 : sandHeight(pos.x, pos.z) + 1, pos.z + this.fwd.z * 3);
          seekTo(_v2, 3);
          speed = sp.burst * 0.8;
          maxTurn = 6;
          if (up && pos.y > TANK.water - 1.4 - (this.localBox?.max.y ?? 0.5) * this.group.scale.x) this.airPhase = 2;
          if (!up && pos.y < sandHeight(pos.x, pos.z) + 2.5) this.airPhase = 0;
        } else {
          _v2.set(this.goal.x, TANK.water - 1.0, this.goal.z);
          seekTo(_v2, 1.5);
          speed = pos.y > TANK.water - 2 - (this.localBox?.max.y ?? 0.5) * this.group.scale.x ? 0.3 : Math.max(sp.cruise * 1.6, 4);
        }
        break;
      }
      case 'chase':
      case 'flare':
      case 'hunt': {
        const p = this.prey;
        if (!p) {
          // aynadaki rakip: cama dönük durur, yüzgeçler gergin, solungaç kapakları açık
          if (this.mirrorPt) { seekTo(this.mirrorPt, 1.5); speed = pos.distanceTo(this.mirrorPt) < 3 ? 0.3 : sp.cruise; this.faceDir = _fd.subVectors(this.mirrorPt, pos).setY(0).normalize(); this.u.uFlap.value += dt * 10; this.gillTarget = 1; maxTurn = 6; }
          break;
        }
        seekTo(p.pos, 2.5);
        const dist = p.pos.distanceTo(pos);
        speed = state === 'flare' ? (dist < 4 ? 0.8 : sp.cruise * 1.5) : sp.burst * (state === 'hunt' ? (dist > 5 ? 0.25 : 0.75) : this.chaseSoft ? 0.45 : 0.6);
        maxTurn = 6;
        if (state === 'flare') {
          // iki erkek beta: yüzgeçler gerilir, yan yana gösteriş
          this.u.uFlap.value += dt * 10;
          this.gillTarget = 1;
          if (dist < 5 && !this.flared) { this.flared = true; world.events.push({ type: 'flare', fish: this }); }
          if (dist < 4) { p.data.stress = Math.min(100, p.data.stress + dt * 6); d.stress = Math.min(100, d.stress + dt * 3); }
        } else if (dist < 6 && !(p.flee > 0) && !this.chaseSoft) p.scare?.(pos, state === 'hunt' ? 1.2 : 0.8, `${this.sp.name} saldırdı`);
        if (state === 'chase' && !this.chaseSoft && dist < 1.5 && !this.nipped) {
          this.nipped = true;
          p.data.stress = Math.min(100, p.data.stress + 15);
          p.data.health = Math.max(0, p.data.health - 2);
          world.events.push({ type: 'nip', fish: this, target: p });
        }
        if (state === 'hunt' && dist < 1.3 && Math.random() < dt * (p.state === 'sleep' ? 4 : 1.2)) {
          world.events.push({ type: 'predation', fish: this, target: p });
          d.hunger = Math.max(0, d.hunger - 30);
          this.prey = null;
        }
        break;
      }
      case 'court': {
        // erkek dişinin önüne geçer; lepistes S gösterisi: gövde bükülür ve titrer
        const p = this.prey;
        if (!p) break;
        _v2.copy(p.pos).addScaledVector(p.fwd, 2.2 * this.total / 3);
        seekTo(_v2, 2);
        const dist = pos.distanceTo(_v2);
        speed = dist > 3 ? sp.cruise * 1.6 : 0.6;
        maxTurn = 6;
        if (dist < 3) {
          this.faceDir = _fd.subVectors(p.pos, pos).normalize();
          if (P.court === 'sigmoid') this.quiver = 1;
          if (P.court === 'display') this.u.uFlap.value += dt * 8;
          if (Math.random() < dt * 0.4) p.scare?.(pos, 0.1, 'erkek ısrarla kur yapıyor');
        }
        break;
      }
      case 'root':
        // burun aşağı, yerinde eşeleme; arada kum bulutu
        seekTo(this.goal, 0.4);
        speed = 0.35;
        this.faceDir = _fd.set(this.fwd.x, -0.8, this.fwd.z).normalize();
        if (Math.random() < dt * 1.2) world.events.push({ type: 'sandPuff', fish: this, at: this.mouthWorld(_mw) });
        break;
      case 'graze': {
        seekTo(this.goal, 1.2);
        const dist = pos.distanceTo(this.goal);
        speed = dist < 1.5 ? 0.15 : sp.cruise;
        if (dist < 2) {
          // ağız yüzeye dönük (cam ya da yaprak)
          const nz = Math.abs(this.goal.z) > HALF_D - 2 ? Math.sign(this.goal.z) : 0;
          this.faceDir = nz ? _fd.set(this.fwd.x * 0.3, 0.2, nz).normalize() : _fd.subVectors(this.goal, pos).normalize();
          this.mouthTarget = 0.3 + 0.3 * Math.sin(this.breath * 3);
        }
        break;
      }
      case 'wait':
        seekTo(this.goal, 1);
        speed = pos.distanceTo(this.goal) < 3 ? 0.4 : sp.cruise * 1.2;
        if (pos.distanceTo(this.goal) < 3) this.faceDir = _fd.set(this.fwd.x, 0.45, this.fwd.z).normalize();
        break;
      case 'nest':
        seekTo(this.goal, 1.5);
        speed = pos.distanceTo(this.goal) < 2 ? 0.3 : sp.cruise;
        break;
      case 'sleep':
        seekTo(this.goal, 0.5);
        speed = pos.distanceTo(this.goal) < 1.5 ? 0.05 : sp.cruise * 0.18;
        maxTurn = 1;
        break;
      case 'school': {
        const ex = world.school?.[this.species]?.excite ?? 0;
        seekTo(this.goal, 0.45);
        // tedirginken sürü sıkılaşır (komşulara daha çok yapışır)
        this.boids(world, acc, 1 + this.alarm * 1.5);
        speed = sp.cruise * (0.9 + ex * 0.6 + this.alarm * 0.5);
        break;
      }
      case 'hide':
        seekTo(this.goal, 0.8);
        speed = pos.distanceTo(this.goal) < 2 ? 0.2 : sp.cruise * 1.1;
        break;
      case 'forage': {
        // kısa koşular + duraklamalar
        this.restTimer -= dt;
        if (this.restTimer < 0) { this.restTimer = Math.random() < 0.5 ? 1 + Math.random() * 4 : 1 + Math.random() * 2; this.resting = !this.resting; }
        if (this.resting) { speed = 0.25; this.state = 'rest'; }
        else seekTo(this.goal, 1);
        break;
      }
      default:
        seekTo(this.goal, 1);
        if (state === 'curious' && pos.distanceTo(this.goal) < 4) { speed = 0.6; this.faceDir = _fd.set(0, 0, 1); }
    }

    if ((P.shoal ?? sp.school) > 0 && !['school', 'flee', 'sleep', 'hunt', 'court'].includes(state)) this.boids(world, acc, (P.shoal ?? sp.school) * 0.35);

    // Ayrılma (tüm balıklar)
    for (const o of world.fish) {
      if (o === this) continue;
      _v2.subVectors(pos, o.pos);
      const min = (this.total + (o.total ?? o.sp?.body?.length ?? 1)) * 0.45;
      const rvx = this.vel.x - (o.vel?.x ?? 0), rvy = this.vel.y - (o.vel?.y ?? 0), rvz = this.vel.z - (o.vel?.z ?? 0);
      const ahead = encounterTime(_v2.x, _v2.y, _v2.z, rvx, rvy, rvz);
      // Anticipate intersecting paths, retaining a consistent side in head-on encounters.
      const cx = _v2.x + rvx * ahead, cy = _v2.y + rvy * ahead, cz = _v2.z + rvz * ahead;
      const closest = Math.hypot(cx, cy, cz);
      if (ahead > 0 && closest < min * 1.4) {
        const yieldStrength = (1 - closest / (min * 1.4)) * (1 - ahead / 0.9);
        acc.x += this.fwd.z * yieldStrength;
        acc.z -= this.fwd.x * yieldStrength;
        speed *= 1 - yieldStrength * 0.25;
      }
      const L = _v2.length();
      if (L < min && L > 1e-4) acc.addScaledVector(_v2, (min - L) / (min * L) * 2.5);
    }
    // Engeller (taş, kök, filtre)
    for (const ob of world.obstacles) {
      _v2.subVectors(pos, ob.pos);
      if (ob.h !== undefined) _v2.y = Math.sign(_v2.y) * Math.max(0, Math.abs(_v2.y) - ob.h);   // dikey silindir (bitki, filtre)
      const L = _v2.length();
      const m = ob.r + 2;
      if (L < m && L > 1e-4) acc.addScaledVector(_v2, ((m - L) / m) * 3 / L);
    }
    // Sınırlar
    const floor = sandHeight(pos.x, pos.z);
    const lo = sp.bottom ? floor + sp.body.height * 0.45 : floor + 2;
    // sınırlar gövde boyuna göre: büyük balık camdan daha erken döner, sırt yüzgeci yüzeyi delmez
    const finTop = (this.localBox?.max.y ?? 0.5) * this.group.scale.x;
    const half = this.total * 0.5;
    const hi = TANK.water - (state === 'air' ? 0.5 : 0.9 + finTop);
    const edge = (val, min, max, k) => (val < min + k ? (min + k - val) / k : 0) - (val > max - k ? (val - (max - k)) / k : 0);
    acc.x += edge(pos.x, -HALF_W + 1 + half, HALF_W - 1 - half, 5) * 4;
    acc.z += edge(pos.z, -HALF_D + 1 + half, HALF_D - 1 - half, 4) * 4;
    acc.y += edge(pos.y, lo, hi, 2.5) * 3;
    // balıklar çoğunlukla yatay yüzer
    if (!sp.bottom && state !== 'air') acc.y *= 0.6;
    // dip balığı suyun ortasında kaldıysa (hava yuttuktan sonra) süzülerek dibe iner
    if (sp.bottom && state !== 'air' && pos.y > floor + 3) { acc.y -= 2; speed = Math.max(speed, sp.cruise * 1.4); }

    // --- Kaçış refleksi (C-start): gövde önce C şeklinde bükülür, sonra fırlar ---
    const fleeing = state === 'flee';
    if (fleeing && !this.wasFleeing) {
      this.cstart = 0.14;
      this.cside = Math.sign(this.fwd.x * this.fleeDir.z - this.fwd.z * this.fleeDir.x) || 1;
    }
    this.wasFleeing = fleeing;
    if (this.cstart > 0) {
      this.cstart -= dt;
      speed = 0.5;
      maxTurn = 22;
    }

    // --- Doğal değişkenlik: tempo ve yön yavaşça kayar; sakin yüzüşte arada duraklar (ağır kuyruklu süreler)
    const calm = !fleeing && !['sleep', 'rest', 'seek', 'eat', 'hunt', 'chase', 'court', 'graze', 'root', 'wait', 'air'].includes(state);
    speed *= this.pers.pace * (this.elder ? 0.82 : 1) * (1 + this.paceDrift.step(dt) * 0.18);
    const wob = this.yawDrift.step(dt) * this.pers.wander * (calm ? 0.35 : 0.06);
    const pob = this.pitchDrift.step(dt) * (calm && !sp.bottom ? 0.12 : 0);
    if (calm && !sp.bottom) {
      this.pauseT -= dt;
      if (this.pauseT <= 0) {
        this.paused = !this.paused && this.rand() < this.pers.pauser;
        this.pauseT = this.paused ? heavyTail(this.rand, 0.6, 12, 1.4) : heavyTail(this.rand, 4, 60);
      }
      if (this.paused) speed *= 0.06;
    } else this.paused = false;

    // --- Hız ve yön ---
    const face = !!this.faceDir;
    const precise = face || PRECISE.has(state);
    if (acc.lengthSq() > 1e-6) acc.normalize();
    if (wob) { const c = Math.cos(wob), sn = Math.sin(wob), ax = acc.x * c + acc.z * sn; acc.z = -acc.x * sn + acc.z * c; acc.x = ax; }
    acc.y += pob;
    if (precise) {
      const desired = _v2.copy(acc).multiplyScalar(speed);
      const accel = state === 'seek' ? 25 : 8;
      const dv = desired.sub(this.vel);
      const dvl = dv.length();
      if (dvl > accel * dt) dv.multiplyScalar((accel * dt) / dvl);
      this.vel.add(dv);
    }

    // dışarıdan itilme (dekor, cam) kısa sürede söner ve birikemez
    this.slip.multiplyScalar(Math.exp(-dt * 5));
    if (this.slip.lengthSq() > 9) this.slip.setLength(3);
    let spd = this.vel.length();
    const steer = face || (precise ? spd > 0.4 : acc.lengthSq() > 1e-6 && speed > 0.04);
    let dyawAbs = 0;
    if (steer) {
      // nişan alırken burun hıza değil yeme döner; itki kipinde gövde istenen yöne döner, hız gövdeyi izler
      const dir = face ? _x.copy(this.faceDir) : precise ? _x.copy(this.vel).divideScalar(spd) : _x.copy(acc);
      const high = pos.y > sandHeight(pos.x, pos.z) + 3;
      const maxPitch = face ? 1.1 : sp.bottom && state !== 'air' && !high ? 0.25 : 0.6;
      // eğim sınırı: yön yatay bileşenini korur (dikey hızda bile balık dik durmaz, ekseni etrafında savrulmaz)
      dir.normalize();
      const py = THREE.MathUtils.clamp(dir.y, -Math.min(maxPitch, 0.82), Math.min(maxPitch, 0.82));
      let hx = dir.x, hz = dir.z, hl = Math.hypot(hx, hz);
      if (hl < 0.25) {
        const fl = Math.hypot(this.fwd.x, this.fwd.z);
        if (fl > 0.2) { hx = this.fwd.x; hz = this.fwd.z; hl = fl; } else { hx = Math.sin(this.lastYaw ?? 0); hz = Math.cos(this.lastYaw ?? 0); hl = 1; }
      }
      const hk = Math.sqrt(1 - py * py) / hl;
      dir.set(hx * hk, py, hz * hk);
      const fl = Math.hypot(this.fwd.x, this.fwd.z);
      let yaw = fl > 0.3 ? Math.atan2(this.fwd.x, this.fwd.z) : (this.lastYaw ?? Math.atan2(dir.x, dir.z));
      let pitch = Math.asin(THREE.MathUtils.clamp(this.fwd.y, -1, 1));
      let dyaw = Math.atan2(dir.x, dir.z) - yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      dyawAbs = Math.abs(dyaw);
      // dönüş eylemsizlikli: açısal hız ivmelenir; yavaşken (yalnız göğüs yüzgeçleriyle) daha ağır döner
      const auth = precise || this.gait === 'hover' ? 1 : 0.4 + 0.6 * Math.min(1, this.drive.u / Math.max(0.5, sp.cruise));
      const alpha = this.cstart > 0 || fleeing ? 400 : precise ? maxTurn * 12 : maxTurn * 4;
      this.turnW = steerRate(dyaw, this.turnW, maxTurn * auth, alpha, dt);
      let stepYaw = this.turnW * dt;
      if (Math.sign(stepYaw) === Math.sign(dyaw) && Math.abs(stepYaw) > dyawAbs) { stepYaw = dyaw; this.turnW *= 0.5; }
      yaw += stepYaw;
      pitch += THREE.MathUtils.clamp(Math.asin(py) - pitch, -maxTurn * 0.5 * dt, maxTurn * 0.5 * dt);
      pitch = THREE.MathUtils.clamp(pitch, -0.96, 0.96);
      this.fwd.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      this.lastYaw = yaw;
      this.yawRate = THREE.MathUtils.lerp(this.yawRate, stepYaw / Math.max(dt, 1e-4), 1 - Math.exp(-dt * 13.4));
    } else {
      this.turnW *= Math.exp(-dt * 6);
      this.yawRate *= Math.exp(-dt * 6.3);
      // dururken yatay pozisyona dön
      this.fwd.y *= Math.exp(-dt * 3.1); this.fwd.normalize();
    }

    if (precise) {
      // gövde yönü yanal kaymayı sınırlar: dönüşünü bitirmemiş balık yan kaymaz
      if (!face && spd > 0.4) {
        const horizontal = Math.hypot(this.vel.x, this.vel.z);
        const forward = Math.max(1e-4, Math.hypot(this.fwd.x, this.fwd.z));
        this.vel.x = this.fwd.x / forward * horizontal;
        this.vel.z = this.fwd.z / forward * horizontal;
      }
      this.drive.u = Math.max(0, this.vel.dot(this.fwd));
      this.drive.thrust += (Math.min(1, spd / Math.max(1, sp.cruise * 2)) - this.drive.thrust) * Math.min(1, dt * 8);
      this.thrust = 1;
    } else {
      // itki fiziği: kuyruk vuruşu ileri iter, su direnci yavaşlatır; keskin dönüş bir vuruşu tetikler ve frenler
      const u = this.drive.step(dt, speed, { urgent: fleeing && this.cstart <= 0, kick: dyawAbs > 0.8, turnLoss: Math.abs(this.turnW) * 0.25 });
      this.vel.copy(this.fwd).multiplyScalar(u).add(this.slip);
      this.thrust = this.drive.gliding ? 0 : 1;
      spd = this.vel.length();
    }
    pos.addScaledVector(this.vel, dt);
    // Fin control resists drift while hovering; coasting bodies follow the same
    // circulation as the food and foliage, without adding current to muscle speed.
    waterCurrent(pos, world.time ?? 0, world.flow ?? 0.25, _wc);
    pos.addScaledVector(_wc, dt * (this.thrust ? 0.22 : 0.8));
    pos.x = THREE.MathUtils.clamp(pos.x, -HALF_W + 1, HALF_W - 1);
    pos.z = THREE.MathUtils.clamp(pos.z, -HALF_D + 1, HALF_D - 1);
    pos.y = THREE.MathUtils.clamp(pos.y, lo - 0.3, TANK.water - 0.4);

    // yavrular büyüdükçe ölçek
    const sc = d.size ?? 1;
    if (Math.abs(this.group.scale.x - sc) > 0.001) { this.group.scale.setScalar(sc); this.total = this.baseTotal * sc; }

    // --- Animasyon parametreleri ---
    const k = Math.min(spd / sp.burst, 1);
    const eel = this.gait === 'eel';
    // kuyruk vuruşu itkiden gelir: vuruşta sık ve geniş, süzülmede gövde düz
    const th = this.drive.thrust;
    let freq = (eel ? 2.5 : 4) + th * (eel ? 6 : 14) + k * 4;
    let amp = 0.012 + th * 0.15 + k * 0.03;
    if (this.gait === 'hover' && spd < 1.5) amp *= 0.5;             // yerinde asılı: yalnız yüzgeçler
    if (state === 'sleep' || state === 'rest') { amp *= 0.12; freq *= 0.3; }
    this.u.uPhase.value += dt * freq;
    this.u.uAmp.value = THREE.MathUtils.lerp(this.u.uAmp.value, amp, 1 - Math.exp(-dt * (this.thrust ? 13.4 : 3.7)));
    const turnBend = THREE.MathUtils.clamp(-this.yawRate * 0.09, -0.35, 0.35);
    // lepistes S gösterisi: gövde bükülü ve hızla titrer
    const bendT = this.cstart > 0 ? this.cside * 1.1 : turnBend + this.quiver * (0.22 + 0.08 * Math.sin(this.time2 = (this.time2 ?? 0) + dt * 40));
    this.bend = THREE.MathUtils.lerp(this.bend, bendT, 1 - Math.exp(-dt * (this.cstart > 0 ? 35.9 : 9.75)));
    this.u.uBend.value = this.bend;
    const asleep = state === 'sleep' || state === 'rest';
    const displaying = state === 'flare' || state === 'court';
    const finSpread = displaying ? 1.15 : asleep ? 0.35 : this.paused ? 0.95 : this.thrust ? 0.85 : 0.55;
    const finActivity = asleep ? 0.07 : spd < 1.5 ? 0.65 : 0.3;
    this.u.uFinSpread.value += (finSpread - this.u.uFinSpread.value) * (1 - Math.exp(-dt * 4));
    this.u.uFinActivity.value += (finActivity - this.u.uFinActivity.value) * (1 - Math.exp(-dt * 6));
    this.u.uFlap.value += dt * (asleep ? 2 : spd < 1.5 ? 8 : 4) * this.breathRate;
    this.u.uIch.value = THREE.MathUtils.lerp(this.u.uIch.value, d.ich ?? 0, 0.05);
    // Nefes: ağız ve solungaç kapakları ritmik olarak açılıp kapanır (stresle hızlanır)
    this.motionPhase += dt * 0.37;
    this.breath += dt * (asleep ? 3 : 5 + d.stress * 0.05 + (world.o2 < 40 ? 4 : 0))
      * this.breathRate * (1 + 0.1 * Math.sin(this.motionPhase));
    const breathe = Math.max(0, Math.sin(this.breath)) ** 1.6;
    const mouthT = Math.max(this.mouthTarget ?? 0, breathe * (asleep ? 0.035 : 0.08 + d.stress * 0.0006));
    this.mouthOpen += (mouthT - this.mouthOpen) * Math.min(1, dt * (mouthT > this.mouthOpen ? 35 : 14));
    this.u.uMouth.value = this.mouthOpen;
    this.gill += (Math.max(this.gillTarget ?? 0, (0.5 + 0.5 * Math.sin(this.breath - 0.8)) * (asleep ? 0.12 : 0.35)) - this.gill) * Math.min(1, dt * 12);
    this.u.uGill.value = this.gill;
    this.u.uPale.value = THREE.MathUtils.lerp(this.u.uPale.value, Math.max((100 - d.health) / 100, d.stress / 160, this.elder ? 0.18 : 0), 0.05);

    // Dönüşüm
    _y.copy(_up);
    _x.crossVectors(_y, this.fwd).normalize();
    _y.crossVectors(this.fwd, _x).normalize();
    _m.makeBasis(_x, _y, this.fwd);
    _q.setFromRotationMatrix(_m);
    // dönüşlerde hafif yatma
    const roll = THREE.MathUtils.clamp(this.yawRate * 0.08, -0.4, 0.4);
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    this.group.quaternion.slerp(_q, 1 - Math.exp(-dt * 41.6));
    this.group.position.copy(pos);
    this.keepInside(world, state === 'air', dt);
    // Ağızdaki yem dudakların hemen içinde durur
    if (this.feed?.food?.held === this) {
      this.group.updateMatrixWorld();
      this.feed.food.pos.copy(this.mouthWorld(_mw, 0.35));
    }
  }

  // Gövdenin (yüzgeçler dahil) cama, su yüzeyine, kuma ve sert dekora girmemesi
  keepInside(world, air, dt) {
    const g = this.group;
    // gövde modeli sonradan değişebilir (gerçek model yüklenince): anahtar değişirse kutuyu yeniden ölç
    let key = '';
    g.traverse((o) => { if (o.isMesh && o.visible) key += o.geometry.uuid; });
    if (key !== this.localKey) { this.localKey = key; this.localBox = null; }
    if (!this.localBox) {
      const p = g.position.clone(), q = g.quaternion.clone(), sc = g.scale.clone();
      g.position.set(0, 0, 0); g.quaternion.identity(); g.scale.set(1, 1, 1);
      g.updateMatrixWorld(true);
      this.localBox = new THREE.Box3().setFromObject(g);
      this.localBox.expandByScalar(Math.max(0.15, this.baseTotal * 0.07));   // yüzme dalgası ve yüzgeç salınımı payı
      g.position.copy(p); g.quaternion.copy(q); g.scale.copy(sc);
    }
    // yerel kutunun 8 köşesini döndürüp dünya eksenli zarfı bul
    const b = this.localBox, s = g.scale.x;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      _wc.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).multiplyScalar(s).applyQuaternion(g.quaternion);
      x0 = Math.min(x0, _wc.x); x1 = Math.max(x1, _wc.x); y0 = Math.min(y0, _wc.y); y1 = Math.max(y1, _wc.y); z0 = Math.min(z0, _wc.z); z1 = Math.max(z1, _wc.z);
    }
    const pos = this.pos, m = 0.25;
    // sert dekor (taş, kök, filtre, bitki gövdeleri): yatayda dışarı it
    const rad = Math.max(x1 - x0, z1 - z0) * 0.3;
    // dekordan uzaklaşma bir kerede değil, balığın kendi yüzüşü hızında (ışınlanma olmasın)
    let px = 0, pz = 0;
    for (const ob of world.obstacles) {
      const dy = pos.y - ob.pos.y;
      if (ob.h !== undefined ? Math.abs(dy) > ob.h : Math.abs(dy) > ob.r * 0.9) continue;
      const dx = pos.x - ob.pos.x, dz = pos.z - ob.pos.z, d = Math.hypot(dx, dz);
      const min = (ob.core ?? ob.r * 0.75) + rad;
      if (d < min && d > 1e-4) { px += dx / d * (min - d); pz += dz / d * (min - d); }
    }
    const pl = Math.hypot(px, pz), maxStep = dt * 5;
    if (pl > maxStep) { px *= maxStep / pl; pz *= maxStep / pl; }
    pos.x += px; pos.z += pz;
    if (pl > 0.01) { this.vel.x += px * 2; this.vel.z += pz * 2; this.slip.x += px * 2; this.slip.z += pz * 2; }   // itilen balık yönünü de oraya çevirir
    // cam ve su yüzeyi en son: dekordan itilme balığı camın dışına taşıyamaz
    pos.x = THREE.MathUtils.clamp(pos.x, -HALF_W + m - x0, HALF_W - m - x1);
    pos.z = THREE.MathUtils.clamp(pos.z, -HALF_D + m - z0, HALF_D - m - z1);
    const top = TANK.water - (air ? -0.05 : 0.15);
    const floor = sandHeight(pos.x, pos.z);
    pos.y = Math.min(pos.y, top - y1);
    pos.y = Math.max(pos.y, floor + 0.05 - y0);
    g.position.copy(pos);
  }

  // Sürü: mesafeye değil, görebildiği en yakın ~6 hemcinse uyum (topolojik komşuluk). Yakındakinden
  // uzaklaş, komşuların gövde yönüne hizalan, yalnızca tercih edilen aralıktan uzaksa yanaş.
  boids(world, acc, w) {
    const pos = this.pos;
    const near = this._near ??= [];
    near.length = 0;
    for (const o of this.mates) if (o.pos.distanceToSquared(pos) < 400) near.push(o);
    if (!near.length) return;
    near.sort((a, b) => a.pos.distanceToSquared(pos) - b.pos.distanceToSquared(pos));
    if (near.length > 6) near.length = 6;
    const coh = _b1.set(0, 0, 0), ali = _b2.set(0, 0, 0), sep = _b3.set(0, 0, 0);
    for (const o of near) {
      coh.add(o.pos);
      ali.addScaledVector(o.fwd ?? o.vel, 1);
      const dx = pos.x - o.pos.x, dy = pos.y - o.pos.y, dz = pos.z - o.pos.z, d = Math.hypot(dx, dy, dz);
      const room = (this.total + (o.total ?? this.total)) * 0.55;
      if (d < room && d > 1e-4) { const k = (room - d) / (room * d); sep.x += dx * k; sep.y += dy * k; sep.z += dz * k; }
    }
    coh.divideScalar(near.length).sub(pos);
    // tedirginken aralık daralır (sıkı sürü)
    const pref = this.total * (1.6 - this.alarm * 0.7);
    const cl = coh.length();
    if (cl > pref) acc.addScaledVector(coh, 0.18 * w * (cl - pref) / cl);
    if (ali.lengthSq() > 0) acc.addScaledVector(ali.normalize(), 0.9 * w);
    acc.addScaledVector(sep, 1.6 * w);
  }

  /** Ağız ucunun dünya konumu; `inset` ağız içine doğru (ağız boyu cinsinden) */
  mouthWorld(out, inset = 0) {
    out.copy(this.mouthLocal);
    out.z -= inset * this.mouthSize() / Math.max(this.group.scale.x, 1e-3);
    return this.group.localToWorld(out);
  }

  mouthSize() { return Math.max(0.12, this.total * 0.07); }

  /**
   * Yem yeme: yaklaş → dur ve nişan al → ağzı açıp emerek atıl → ağızda tut →
   * yut (ya da büyük pulu ısırıp kalanını tükür).
   */
  updateFeeding(dt, world, food, seekTo) {
    const d = this.data;
    const sp = this.sp;
    let fe = this.feed;
    if (food && (!fe || fe.food !== food) && !(fe && (fe.phase === 'hold' || fe.phase === 'spit'))) {
      fe = this.feed = { food, phase: 'approach', t: 0, aimT: 0 };
    }
    this.mouthTarget = 0;
    this.gillTarget = 0;
    this.faceDir = null;
    this.feedSpeed = sp.cruise;
    this.feedTurn = 4;
    if (!fe) return;
    const f = fe.food;
    fe.t += dt;
    const mouth = this.mouthWorld(_mw);
    const toFood = _v2.subVectors(f.pos, mouth);
    const dist = toFood.length();
    const L = this.total;
    const ms = this.mouthSize();
    if ((f.eaten || (f.held && f.held !== this)) && fe.phase !== 'hold') { this.feed = null; return; }

    switch (fe.phase) {
      case 'approach':
        seekTo(f.pos, 2.2);
        this.feedSpeed = Math.min(sp.burst * 0.55, 2 + dist * 1.2);
        this.feedTurn = 7;
        if (dist < L * 1.4 + 0.6) {
          fe.phase = 'aim'; fe.t = 0;
          fe.aimT = (0.12 + Math.random() * 0.5) * (d.trait === 'Obur' ? 0.4 : 1);
        }
        break;
      case 'aim': {
        // dur, burnu yeme çevir; ağız hafifçe aralanır
        seekTo(f.pos, 1);
        this.feedSpeed = dist > L * 0.5 ? 1.2 : 0.3;
        this.feedTurn = 10;
        this.mouthTarget = 0.2;
        this.faceDir = _fd.copy(toFood).normalize();
        const aligned = this.fwd.angleTo(this.faceDir) < 0.4;
        if ((fe.t > fe.aimT && aligned) || fe.t > fe.aimT + 1.2) { fe.phase = 'strike'; fe.t = 0; }
        if (dist > L * 3) { fe.phase = 'approach'; fe.t = 0; }
        break;
      }
      case 'strike':
        // ani atılma + emme: ağız sonuna kadar açılır, yakındaki yem ağza akar
        seekTo(f.pos, 4);
        this.feedSpeed = sp.burst * 0.6;
        this.feedTurn = 14;
        this.mouthTarget = 1;
        this.gillTarget = 0.8;
        if (dist > 1e-3) this.faceDir = _fd.copy(toFood).normalize();
        if (dist < L * 0.45 + ms * 2) {
          const pull = Math.min(1, dt * (14 + 30 * (1 - dist / (L * 0.45 + ms * 2))));
          f.pos.lerp(mouth, pull);
          if (f.state === 'settled') f.state = 'sink';
        }
        if (dist < ms * 0.9) {
          f.held = this;
          fe.phase = 'hold'; fe.t = 0;
          fe.holdT = 0.35 + Math.random() * 0.5;
          // ağzına sığmayan pul: ısırılır, kalanı tükürülür
          const flake = 0.2 * (f.size ?? 1);
          fe.spit = flake > ms * 1.6 ? Math.random() < 0.75 : Math.random() < 0.12;
        } else if (fe.t > 0.9) { fe.phase = 'aim'; fe.t = 0; fe.aimT = 0.15; }
        break;
      case 'hold':
        // ağız kapanır, balık süzülür; solungaçlar çiğnerken pompalar
        this.feedSpeed = 0.6;
        this.feedTurn = 3;
        this.mouthTarget = 0;
        this.gillTarget = 0.5 + 0.5 * Math.sin(fe.t * 28);
        if (fe.t > fe.holdT) {
          if (fe.spit) {
            fe.phase = 'spit'; fe.t = 0;
          } else {
            f.held = null;
            f.eaten = true;
            d.hunger = Math.max(0, d.hunger - 10 * Math.min(1.5, f.size ?? 1));
            world.events.push({ type: 'eat', fish: this, food: f });
            this.feed = null;
          }
        }
        break;
      case 'spit':
        this.feedSpeed = 0.3;
        this.mouthTarget = 1;
        this.gillTarget = 1;
        if (fe.t > 0.06 && f.held === this) {
          // ısırılan parça yutuldu, kalan pul ağızdan fırlar
          f.held = null;
          f.size = (f.size ?? 1) * 0.6;
          f.pos.copy(this.mouthWorld(_mw)).addScaledVector(this.fwd, ms * 1.5);
          f.state = 'sink';
          f.kick = this.fwd.clone().multiplyScalar(2.5);
          d.hunger = Math.max(0, d.hunger - 4);
          world.events.push({ type: 'eat', fish: this, food: null });
        }
        if (fe.t > 0.25) { this.feed = null; }
        break;
    }
  }

  findFood(world) {
    let best = null, bd = 40;
    for (const f of world.food) {
      if (f.eaten || f.held) continue;
      if (this.sp.bottom ? f.pos.y > 8 : f.state === 'settled') continue;
      const d = f.pos.distanceTo(this.pos);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  scare(from, strength = 1, why = 'ani hareket / gölge') {
    const d = this.pos.distanceTo(from);
    if (d > 30) return;
    this.fleeWhy = why;
    this.alarm = Math.max(this.alarm ?? 0, Math.min(1, strength * (1 - d / 30) * 1.5));
    this.remember?.('danger', from, strength, 6);
    this.flee = 0.8 + Math.random() * 0.8;
    this.fleeAge = 0;
    this.scareLvl = strength;
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
    this.group.traverse((o) => {
      o.material?.dispose?.();
      o.customDepthMaterial?.dispose();
    });
  }
}
