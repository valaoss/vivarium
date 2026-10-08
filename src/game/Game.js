import * as THREE from 'three';
import { MOBILE, TANK, TANKS, HALF_W, HALF_D, LIGHT_ON_HOUR, LIGHT_OFF_HOUR, OFFLINE_CAP_MIN, GAME_MIN_PER_SEC } from '../config.js';
import { createRenderer, createCamera, createControls, createRoom } from '../render/scene.js';
import { WU, createWaterVolume, createWaterSurface, createMeniscus, createGodRays } from '../render/water.js';
import { createTank, ALGAE_GRID } from '../render/glass.js';
import { PlanarReflection, PlaneMirror } from '../render/reflection.js';
import { MIRROR_U } from '../render/glass.js';
import { WaterSim } from '../render/waterSim.js';
import { createDust, createBubbles, createFoodMesh } from '../render/particles.js';
import { createPostFX } from '../render/postfx.js';
import { createSubstrate, sandHeight } from '../world/substrate.js';
import { createFeeder } from '../world/feeder.js';
import { createPlants, PLANT_TYPES } from '../world/plants.js';
import { SPECIES, NAMES, levelFromXp, xpForLevel } from '../creatures/species.js';
import { Fish } from '../creatures/Fish.js';
import { Shrimp } from '../creatures/Shrimp.js';
import { Snail } from '../creatures/Snail.js';
import { FISH_SHARED } from '../creatures/fishMaterial.js';
import { newWater, tick, quality, turbidity, waterChange } from '../sim/ecosystem.js';
import { QUESTS, currentQuest } from './quests.js';
import { mulberry } from '../render/textures.js';

const SAVE_KEY = 'vivarium.save.v1';
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane();
const _hit = new THREE.Vector3();

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = createRenderer(canvas);
    this.scene = new THREE.Scene();
    this.camera = createCamera();
    this.controls = createControls(this.camera, canvas);
    this.room = createRoom(this.scene, this.renderer);
    this.tank = createTank(this.scene);
    this.substrate = createSubstrate(this.scene);
    this.plants = createPlants(this.scene);

    this.waterSim = new WaterSim(this.renderer);
    this.waterSim.sources.filter = this.substrate.equipment.filterOut;
    this.scene.add(createWaterVolume());
    this.reflection = new PlanarReflection(this.renderer, this.scene, TANK.water, { scale: MOBILE ? 0.3 : 0.4 });
    if (location.search.includes('norefl')) this.reflection.uniforms.uReflOn.value = 0;
    this.surface = createWaterSurface(this.reflection);
    this.scene.add(this.surface);
    const meniscus = createMeniscus();
    this.scene.add(meniscus);
    this.godrays = createGodRays();
    this.scene.add(this.godrays);
    this.dust = createDust(MOBILE ? 350 : 700);
    this.scene.add(this.dust);
    this.bubbles = createBubbles(this.substrate.equipment.airstone);
    this.bubbles.userData.onPop = (x, z, r) => this.waterSim.drop(x, z, 0.3 + r * 3, 0.01 + r * 0.12);
    this.scene.add(this.bubbles);
    this.foodMesh = createFoodMesh();
    this.scene.add(this.foodMesh);
    this.feeder = createFeeder();
    this.scene.add(this.feeder.group);

    // Bitki yerleştirme önizleme halkası
    this.ghost = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.1, 40),
      new THREE.MeshBasicMaterial({ color: 0xbfffd8, transparent: true, opacity: 0.6, depthTest: false }),
    );
    this.ghost.rotation.x = -Math.PI / 2;
    this.ghost.visible = false;
    this.ghost.renderOrder = 20;
    this.scene.add(this.ghost);
    this.reflection.hide(this.surface, meniscus, this.ghost, this.godrays, this.dust);
    // Yan camlardaki tam iç yansıma: kameranın baktığı camın iki komşu camı ayna olur
    this.mirrors = [0, 1].map(() => new PlaneMirror(this.renderer, this.scene, { scale: MOBILE ? 0.22 : 0.3 }));
    for (const m of this.mirrors) m.hide(...this.tank.panels, meniscus, this.ghost, this.godrays, this.dust);
    MIRROR_U.tMir0.value = this.mirrors[0].target.texture;
    MIRROR_U.tMir1.value = this.mirrors[1].target.texture;
    if (location.search.includes('notir')) this.mirrors.length = 0;
    this.mirrorFrame = 0;

    this.fx = createPostFX(this.renderer, this.scene, this.camera);

    this.WU = WU;
    this.creatures = [];
    this.food = [];
    this.events = [];
    this.taps = [];
    this.mode = 'view';
    this.speed = 1;
    this.selected = null;
    this.follow = false;
    this.photo = false;
    this.time = 0;
    this.simAcc = 0;
    this.lightLevel = 1;
    this.listeners = {};
    this.school = Object.fromEntries(Object.entries(SPECIES).filter(([, sp]) => sp.depth).map(([k]) => [k, { target: new THREE.Vector3(0, 18, 0), timer: 0, excite: 0 }]));
    this.obstacles = [...this.substrate.rocks, ...this.substrate.wood, ...this.substrate.equipment.obstacles];

    this.algaeGrid = new Float32Array(ALGAE_GRID.w * ALGAE_GRID.h);

    this.load();
    this.bindInput();
    this.fitTank();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    window.addEventListener('beforeunload', () => this.save());
    setInterval(() => this.save(), 10000);
  }

  on(ev, fn) { (this.listeners[ev] ??= []).push(fn); }
  emit(ev, data) { for (const fn of this.listeners[ev] ?? []) fn(data); }
  toast(text, kind = 'info') { this.emit('toast', { text, kind }); }
  sfx(name, opts) { this.emit('sfx', { name, opts }); }

  // ------------------------------------------------------------------ Durum
  newState() {
    const s = {
      version: 1,
      minutes: 9 * 60,
      coins: 40,
      coinFrac: 0,
      water: newWater(),
      airstone: true,
      lightOverride: null,
      creatures: [],
      care: [],
      plants: [],
      leftovers: 0,
      questIndex: 0,
      counters: { fed: 0, planted: 0, inspected: 0, wiped: 0, waterChanges: 0, photos: 0, healthyMin: 0, taps: 0 },
      discoveries: [],
      unlocked: { guppy: true, neon: true, cory: false, shrimp: false },
      xp: 0,
      algae: null,
      savedAt: Date.now(),
      firstRun: true,
    };
    return s;
  }

  load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { s = null; }
    const fresh = !s || s.version !== 1;
    this.state = fresh ? this.newState() : s;
    this.state.xp ??= 0;
    this.state.counters.cured ??= 0;

    // Ön camdaki yosun
    if (this.state.algae) {
      const arr = this.state.algae;
      for (let i = 0; i < this.algaeGrid.length; i++) this.algaeGrid[i] = (arr[i] ?? 0) / 255;
    } else {
      const r = mulberry(5);
      for (let y = 0; y < ALGAE_GRID.h; y++) for (let x = 0; x < ALGAE_GRID.w; x++) {
        const low = Math.max(0, 1 - y / (ALGAE_GRID.h * 0.45));
        const corner = Math.max(0, 1 - Math.min(x, ALGAE_GRID.w - x) / 14);
        this.algaeGrid[y * ALGAE_GRID.w + x] = Math.min(1, (low * 0.55 + corner * 0.35) * (0.5 + r() * 0.7));
      }
    }

    if (fresh) {
      this.addPlant('vallisneria', -22, -10, { growth: 0.9 });
      this.addPlant('vallisneria', -14, -12, { growth: 0.75 });
      this.addPlant('vallisneria', 24, -11, { growth: 0.8 });
      this.addPlant('javafern', -10, -8.6, { growth: 0.8, y: 11.8 });
      this.addPlant('anubias', 2, 6, { growth: 0.8 });
      this.spawn('guppy', { palette: 0, pos: [-5, 24, 0] });
      this.spawn('guppy', { palette: 1, pos: [6, 22, 3] });
      this.state.counters.planted = 0;
    } else {
      for (const p of this.state.plants) this.plants.add(p.type, p.x, p.z, p);
      this.state.plants = this.plants.plants;
      const datas = this.state.creatures;
      this.state.creatures = [];
      for (const d of datas) this.addCreature(d);
      for (let i = 0; i < Math.min(this.state.leftovers, 60); i++) this.spawnSettledFood();
      this.offlineCatchUp();
    }
    this.state.plants = this.plants.plants;
    this.algaeDirty = true;
  }

  serialize() {
    const s = this.state;
    return {
      ...s,
      creatures: this.creatures.map((c) => c.serialize()),
      plants: this.plants.plants.map((p) => ({ type: p.type, x: p.x, z: p.z, y: p.y, growth: +p.growth.toFixed(3), health: +p.health.toFixed(3), seed: p.seed })),
      leftovers: this.food.filter((f) => f.state === 'settled' && !f.eaten).length,
      algae: Array.from(this.algaeGrid, (v) => Math.round(v * 255)),
      savedAt: Date.now(),
    };
  }

  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.serialize())); } catch (e) { console.warn('Kayıt başarısız', e); }
  }

  reset() {
    localStorage.removeItem(SAVE_KEY);
    window.removeEventListener('beforeunload', this.save);
    this.save = () => {};
    location.reload();
  }

  offlineCatchUp() {
    const elapsedMin = Math.min(OFFLINE_CAP_MIN, ((Date.now() - (this.state.savedAt ?? Date.now())) / 1000) * GAME_MIN_PER_SEC);
    if (elapsedMin < 5) return;
    const before = { q: quality(this.state.water), coins: this.state.coins };
    // Artık yemler zamanla çürür
    const decay = this.food.filter((f) => f.state === 'settled').length;
    this.state.water.waste += decay * 1.2;
    for (const f of this.food) f.eaten = true;
    let left = elapsedMin;
    while (left > 0) {
      const step = Math.min(5, left);
      this.simStep(step, true);
      left -= step;
    }
    const h = Math.floor(elapsedMin / 60), m = Math.round(elapsedMin % 60);
    const q = quality(this.state.water);
    this.pendingWelcome = `Sen yokken ${h ? h + ' saat ' : ''}${m} dakika geçti. Su kalitesi ${Math.round(before.q)} → ${Math.round(q)}, ${this.state.coins - before.coins} bakım parası kazandın.`;
  }

  // ---------------------------------------------------------------- Varlıklar
  // Sert dekor + bitki gövdeleri (balıklar yaprakların içinden geçmesin diye dikey silindirler)
  allObstacles() {
    const list = this.obstacles.slice();
    for (const p of this.plants.plants) {
      if (p.type === 'frogbit') continue;
      const h = p.size?.h ?? (p.type === 'vallisneria' ? 20 * (0.35 + 0.65 * p.growth) : 8);
      const r = p.size ? Math.max(1, p.size.r * 0.45) : 1.6;
      list.push({ pos: new THREE.Vector3(p.x, p.y + h / 2, p.z), r: r + 1.5, core: r, h: h / 2 });
    }
    return list;
  }

  // Dikim yeri taşın, kökün, ekipmanın ya da başka bir bitkinin gövdesinin içine denk gelmesin
  plantBlocked(type, x, z) {
    if (type === 'frogbit') return null;
    const floor = sandHeight(x, z);
    for (const o of this.obstacles) {
      if (o.pos.y - floor > (o.core ?? o.r) + 2) continue;          // yukarıdaki dallar engel değil
      if (Math.hypot(x - o.pos.x, z - o.pos.z) < (o.core ?? o.r * 0.75) + 1) return 'Bu nokta taşa ya da köke çok yakın; bitki içinden geçerdi.';
    }
    for (const p of this.plants.plants) {
      if (p.type === 'frogbit' || p.y > sandHeight(p.x, p.z) + 1) continue;
      if (Math.hypot(x - p.x, z - p.z) < 2.6) return 'Burada zaten bir bitki var; biraz yana dik.';
    }
    return null;
  }

  addPlant(type, x, z, opts = {}) {
    const p = this.plants.add(type, x, z, opts);
    return p;
  }

  spawn(species, extra = {}) {
    const sp = SPECIES[species];
    const r = Math.random;
    const used = new Set(this.creatures.map((c) => c.data.name));
    const pool = NAMES.filter((n) => !used.has(n));
    const data = {
      id: Math.floor(r() * 1e9),
      species,
      name: pool.length ? pool[Math.floor(r() * pool.length)] : NAMES[Math.floor(r() * NAMES.length)],
      trait: sp.traits[Math.floor(r() * sp.traits.length)],
      hunger: 30,
      health: 100,
      stress: 35,
      age: 0,
      size: 0.9 + r() * 0.2,
      seed: r() * 100,
      palette: extra.palette ?? Math.floor(r() * 6),
      sex: extra.sex ?? (r() < 0.5 ? 'm' : 'f'),
      pos: extra.pos ?? [(r() - 0.5) * TANK.w * 0.5, TANK.water - 3, (r() - 0.5) * TANK.d * 0.4],
    };
    return this.addCreature(data);
  }

  addCreature(data) {
    const kind = SPECIES[data.species].kind;
    const C = kind === 'shrimp' ? Shrimp : kind === 'snail' ? Snail : Fish;
    const c = new C(data);
    this.creatures.push(c);
    this.state.creatures.push(data);
    this.state.seen ??= [];
    if (!this.state.seen.includes(data.species)) this.state.seen.push(data.species);
    this.scene.add(c.group);
    return c;
  }

  removeCreature(c) {
    this.scene.remove(c.group);
    c.dispose();
    this.creatures.splice(this.creatures.indexOf(c), 1);
    this.state.creatures.splice(this.state.creatures.indexOf(c.data), 1);
    if (this.selected === c) this.select(null);
  }

  count(species) { return this.creatures.filter((c) => c.species === species).length; }
  counts() { return Object.fromEntries(Object.keys(SPECIES).map((k) => [k, this.count(k)])); }

  // ------------------------------------------------------- Doğa seviyesi
  get level() { return levelFromXp(this.state.xp); }
  levelProgress() {
    const l = this.level, a = xpForLevel(l), b = xpForLevel(l + 1);
    return (this.state.xp - a) / (b - a);
  }
  isUnlocked(key) {
    const sp = SPECIES[key];
    return !!this.state.unlocked[key] || this.level >= (sp.level ?? 1);
  }
  addXp(n) {
    const before = this.level;
    this.state.xp += n;
    const after = this.level;
    if (after > before) {
      const opened = Object.entries(SPECIES).filter(([, sp]) => sp.level > before && sp.level <= after).map(([, sp]) => sp.name);
      this.toast(`Doğa Seviyesi ${after}!${opened.length ? ' Yeni türler: ' + opened.join(', ') : ''}`, 'good');
      this.emit('levelup', after);
    }
  }

  // Salyangozların camdaki yosunu kazıması
  cleanGlass(x, y, amount) {
    const u = (x + HALF_W + TANK.glass) / (TANK.w + 2 * TANK.glass);
    const v = (y + TANK.glass) / (TANK.h + TANK.glass);
    const cx = u * ALGAE_GRID.w, cy = v * ALGAE_GRID.h;
    let removed = 0;
    for (let yy = Math.floor(cy - 1.5); yy <= Math.ceil(cy + 1.5); yy++) for (let xx = Math.floor(cx - 1.5); xx <= Math.ceil(cx + 1.5); xx++) {
      if (xx < 0 || yy < 0 || xx >= ALGAE_GRID.w || yy >= ALGAE_GRID.h) continue;
      const d = Math.hypot(xx - cx, yy - cy) / 1.6;
      if (d > 1) continue;
      const i = yy * ALGAE_GRID.w + xx;
      const b = this.algaeGrid[i];
      this.algaeGrid[i] = Math.max(0, b - amount * (1 - d));
      removed += b - this.algaeGrid[i];
    }
    if (removed > 0) this.algaeDirty = true;
    return removed;
  }

  // -------------------------------------------------------------- Üreme
  // Doğuran türler (lepistes, plati, moli, kılıçkuyruk): sağlıklı bir dişi ve
  // erkek varsa ara sıra 2–4 yavru doğar; yavrular birkaç günde büyür.
  updateBreeding(dtMin) {
    const h = dtMin / 60;
    for (const c of this.creatures) {
      const d = c.data;
      if (d.fry && d.size < (d.adultSize ?? 1)) {
        d.size = Math.min(d.adultSize ?? 1, d.size + 0.012 * h * (d.hunger < 60 ? 1 : 0.3));
        if (d.size >= (d.adultSize ?? 1) - 0.001) {
          d.fry = false;
          this.toast(`${d.name} artık yetişkin bir ${c.sp.name.toLowerCase()}!`, 'good');
          this.discover('fryGrown', 'Yavrular bitkiler arasında saklanarak büyür; sık bitkili tanklarda hayatta kalma şansları artar.');
        }
      }
    }
    if (this.creatures.length >= TANK.cap) return;
    for (const mother of [...this.creatures]) {
      const sp = mother.sp, d = mother.data;
      if (!sp.livebearer || d.sex !== 'f' || d.fry || d.health < 70 || d.hunger > 65) continue;
      const hasMale = this.creatures.some((o) => o.species === mother.species && o.data.sex === 'm' && !o.data.fry);
      if (!hasMale || Math.random() > 0.022 * h) continue;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n && this.creatures.length < TANK.cap; i++) {
        const fry = this.spawn(mother.species, {
          palette: Math.random() < 0.5 ? d.palette : Math.floor(Math.random() * 6),
          pos: [mother.pos.x + (Math.random() - 0.5) * 2, mother.pos.y, mother.pos.z + (Math.random() - 0.5) * 2],
        });
        Object.assign(fry.data, { size: 0.32, adultSize: 0.85 + Math.random() * 0.25, fry: true, trait: 'Çekingen', hunger: 20, stress: 20 });
      }
      this.state.counters.births = (this.state.counters.births ?? 0) + 1;
      this.toast(`${d.name} (${sp.name}) ${n} yavru doğurdu! Yavrular bitkiler arasında saklanacak.`, 'good');
      this.discover('birth', `${sp.name} doğuran bir türdür; yumurta yerine canlı yavru dünyaya getirir.`);
    }
  }

  // ------------------------------------------------------------ Hastalık
  treat(c) {
    if (!c?.data.ich || c.data.treating) return false;
    if (this.state.coins < 12) { this.toast('Tedavi için 12 bakım parası gerekiyor.', 'warn'); return false; }
    this.state.coins -= 12;
    c.data.treating = true;
    this.toast(`${c.data.name} için ilaç suya eklendi. Birkaç saat içinde benekler kaybolacak.`, 'good');
    return true;
  }

  updateDisease(dtMin) {
    const h = dtMin / 60;
    const q = quality(this.state.water);
    const sick = this.creatures.filter((c) => (c.data.ich ?? 0) > 0.3).length;
    for (const c of this.creatures) {
      if (c.sp.kind !== 'fish') continue;
      const d = c.data;
      if (!d.ich) {
        // stres + kötü su (veya hasta komşu) beyaz beneği tetikler
        let risk = 0;
        if (d.stress > 55 && q < 65) risk += 0.06;
        if (sick && d.stress > 40) risk += 0.04 * sick;
        if (Math.random() < risk * h) {
          d.ich = 0.05;
          this.toast(`${d.name} üzerinde beyaz benekler belirdi. Hasta balığa dokunup tedavi edebilirsin.`, 'warn');
        }
        continue;
      }
      if (d.treating) {
        d.ich = Math.max(0, d.ich - 0.25 * h);
        if (d.ich === 0) {
          d.treating = false;
          this.state.counters.cured++;
          this.toast(`${d.name} tamamen iyileşti!`, 'good');
          this.discover('cured', 'Beyaz benek (Ich) parazitinin sık su değişimi ve tedaviyle yenilebildiğini öğrendin.');
        }
      } else {
        d.ich = Math.min(1, d.ich + (q > 80 && d.stress < 30 ? -0.03 : 0.08) * h);
      }
      d.health = Math.max(0, d.health - d.ich * 3 * h);
      d.stress = Math.min(100, d.stress + d.ich * 4 * h);
    }
  }

  // ------------------------------------------------------------------- Yem
  dropFood(x, z) {
    const n = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      if (this.food.length > 220) break;
      this.food.push({
        pos: new THREE.Vector3(x + (Math.random() - 0.5) * 3, TANK.water - 0.05, z + (Math.random() - 0.5) * 3),
        state: 'float',
        t: 1.5 + Math.random() * 3,
        age: 0,
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0),
        spin: (Math.random() - 0.5) * 3,
        eaten: false,
        size: 0.5 + Math.random() ** 2 * 1.6,
      });
    }
    this.waterSim.drop(x, z, 1.4, 0.09);
    for (const f of this.food.slice(-n)) this.waterSim.drop(f.pos.x, f.pos.z, 0.45, 0.025);
    this.sfx('feed');
    this.state.counters.fed++;
    for (const s of Object.values(this.school)) s.excite = 1;
    const settled = this.food.filter((f) => f.state === 'settled').length;
    if (settled > 25) this.toast('Tabanda çok fazla yem birikti. Artık yemler suyu kirletir ve yosunu besler.', 'warn');
  }

  // Yem kutusu el yüksekliğinde (cam kenarının üstünde) ve lamba armatürünün önünde gezinir
  feederAt(e) {
    const ray = this.rayFromEvent(e);
    _plane.set(new THREE.Vector3(0, 1, 0), -(TANK.h + 4.6));
    if (ray.intersectPlane(_plane, _hit)) this.moveFeeder(_hit.x, _hit.z);
  }
  moveFeeder(x, z) {
    const first = !this.feederPlaced;
    this.feederPlaced = true;
    const lampFront = 5.5 + 2.9;
    this.feederTarget = (this.feederTarget ?? new THREE.Vector3()).set(
      THREE.MathUtils.clamp(x, -HALF_W + 3, HALF_W - 3),
      TANK.h + 4.6,
      THREE.MathUtils.clamp(z, Math.min(lampFront, HALF_D - 2.6), HALF_D - 2.6),
    );
    if (first) this.feeder.group.position.copy(this.feederTarget);
  }
  emitFlake(p) {
    if (this.food.length > 220) return;
    this.food.push({
      pos: p, state: 'air', vel: new THREE.Vector3((Math.random() - 0.5) * 6, -4 - Math.random() * 6, -4 - Math.random() * 8),
      t: 0, age: 0, rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), spin: (Math.random() - 0.5) * 14, eaten: false,
      size: 0.5 + Math.random() ** 2 * 1.6,
    });
  }

  spawnSettledFood() {
    const x = (Math.random() - 0.5) * (TANK.w - 6), z = (Math.random() - 0.5) * (TANK.d - 6);
    this.food.push({ pos: new THREE.Vector3(x, sandHeight(x, z) + 0.1, z), state: 'settled', t: 0, age: Math.random() * 60, rot: new THREE.Euler(-Math.PI / 2, 0, Math.random() * 6), spin: 0, eaten: false });
  }

  updateFood(dt, dtMin) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (let i = this.food.length - 1; i >= 0; i--) {
      const f = this.food[i];
      if (f.eaten) { this.food.splice(i, 1); continue; }
      if (f.held) {
        if (!this.creatures.includes(f.held)) { f.held = null; f.state = 'sink'; }
        continue;
      }
      if (f.kick) {
        // tükürülen pul: kısa bir itki, sonra yine batar
        f.pos.addScaledVector(f.kick, dt);
        f.kick.multiplyScalar(Math.max(0, 1 - dt * 5));
        if (f.kick.lengthSq() < 0.01) f.kick = null;
      }
      if (f.state === 'air') {
        // havada süzülen pul: yerçekimi, hava direnci ve yaprak gibi salınım
        f.vel.y = Math.max(-38, f.vel.y - 420 * dt);
        f.vel.x *= 1 - dt * 3; f.vel.z *= 1 - dt * 3;
        f.pos.addScaledVector(f.vel, dt);
        f.pos.x += Math.sin(this.time * 11 + i) * dt * 2;
        f.rot.x += f.spin * dt; f.rot.y += f.spin * 0.6 * dt;
        f.pos.x = THREE.MathUtils.clamp(f.pos.x, -HALF_W + 0.5, HALF_W - 0.5);
        f.pos.z = THREE.MathUtils.clamp(f.pos.z, -HALF_D + 0.5, HALF_D - 0.5);
        if (f.pos.y <= TANK.water - 0.05) {
          f.pos.y = TANK.water - 0.05;
          f.state = 'float';
          f.t = 1.5 + Math.random() * 3;
          f.rot.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.3;
          this.waterSim.drop(f.pos.x, f.pos.z, 0.45, 0.03);
          if (!this.pourLanded) {
            this.pourLanded = true;
            this.sfx('feed');
            this.state.counters.fed++;
            for (const sc of Object.values(this.school)) sc.excite = 1;
            const settled = this.food.filter((o) => o.state === 'settled').length;
            if (settled > 25) this.toast('Tabanda çok fazla yem birikti. Artık yemler suyu kirletir ve yosunu besler.', 'warn');
          }
        }
      } else if (f.state === 'float') {
        f.t -= dt;
        f.pos.x += Math.sin(this.time + i) * dt * 0.4;
        if (f.t < 0) f.state = 'sink';
      } else if (f.state === 'sink') {
        f.pos.y -= dt * (0.9 + Math.sin(this.time * 3 + i) * 0.3);
        f.pos.x += Math.sin(this.time * 2 + i * 1.7) * dt * 0.6;
        f.rot.x += f.spin * dt; f.rot.z += f.spin * 0.7 * dt;
        const floor = sandHeight(f.pos.x, f.pos.z) + 0.12;
        if (f.pos.y <= floor) { f.pos.y = floor; f.state = 'settled'; f.rot.set(-Math.PI / 2, 0, f.rot.z); }
      } else {
        f.age += dtMin;
        if (f.age > 150) { this.state.water.waste += 1.2; this.food.splice(i, 1); continue; }
      }
    }
    for (const f of this.food) {
      if (n >= 240) break;
      q.setFromEuler(f.rot);
      const fade = f.state === 'settled' ? Math.max(0.5, 1 - f.age / 300) : 1;
      s.setScalar(fade * (f.size ?? 1));
      m4.compose(f.pos, q, s);
      this.foodMesh.setMatrixAt(n++, m4);
    }
    this.foodMesh.count = n;
    this.foodMesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ Zaman/ışık
  get hour() { return (this.state.minutes % 1440) / 60; }
  get day() { return Math.floor(this.state.minutes / 1440) + 1; }

  scheduledLight(minutes = this.state.minutes) {
    const h = (minutes % 1440) / 60;
    return h >= LIGHT_ON_HOUR && h < LIGHT_OFF_HOUR;
  }

  lightOn() {
    const o = this.state.lightOverride;
    if (o && this.state.minutes < o.until) return o.on;
    return this.scheduledLight();
  }

  toggleLight() {
    const on = !this.lightOn();
    // bir sonraki programlı değişime kadar geçerli
    let m = this.state.minutes;
    const cur = this.scheduledLight(m);
    while (this.scheduledLight(m) === cur && m < this.state.minutes + 1440) m += 10;
    this.state.lightOverride = { on, until: m };
  }

  updateLighting(dtMin) {
    const target = this.lightOn() ? 1 : 0;
    const step = dtMin / 25;
    this.lightLevel += THREE.MathUtils.clamp(target - this.lightLevel, -step, step);
    const L = this.lightLevel;
    const h = this.hour;
    // gün doğumu / batımında sıcak renk
    const warm = Math.max(0, 1 - Math.min(Math.abs(h - LIGHT_ON_HOUR - 0.4), Math.abs(h - LIGHT_OFF_HOUR + 0.4)) / 1.3);
    const day = new THREE.Color(1, 0.97, 0.92).lerp(new THREE.Color(1, 0.72, 0.45), warm * 0.8);
    const moon = new THREE.Color(0.32, 0.45, 1);
    const moonK = 0.08;
    const lampCol = moon.clone().lerp(day, Math.min(1, L * 1.2));
    WU.uLampColor.value.copy(lampCol);
    WU.uLamp.value = Math.max(L, moonK);
    this.room.lamp.color.copy(lampCol);
    this.room.lamp.intensity = 0.3 + L * 2.4;
    this.room.spill.color.copy(lampCol);
    this.room.spill.intensity = 80 + L * 900;
    this.tank.lampEmitMat.color.copy(lampCol).multiplyScalar(0.3 + L * 3.5);

    // Oda: gündüz pencere, akşam abajur
    const daylight = THREE.MathUtils.smoothstep(h, 6, 9) * (1 - THREE.MathUtils.smoothstep(h, 17.5, 20));
    const evening = (h > 17 || h < 1) ? 1 : 0;
    this.lampFade = THREE.MathUtils.lerp(this.lampFade ?? evening, evening, 0.05);
    this.room.window.intensity = daylight * 0.55;
    this.room.hemi.intensity = 0.04 + daylight * 0.16;
    this.room.floorLamp.intensity = this.lampFade * 9000;
    this.room.shade.material.emissiveIntensity = this.lampFade * 0.8;
    this.scene.environmentIntensity = 0.1 + daylight * 0.15;

    this.night = Math.max(0, 1 - L * 1.4);
    FISH_SHARED.uNight.value = this.night;
  }

  // -------------------------------------------------------------- Simülasyon
  simStep(dtMin, offline = false) {
    const s = this.state;
    const counts = {};
    for (const c of s.creatures) counts[c.species] = (counts[c.species] ?? 0) + 1;
    const leftovers = this.food.filter((f) => f.state === 'settled' && !f.eaten).length;
    const light = offline ? (this.scheduledLight() ? 1 : 0) : this.lightLevel;
    tick(s, dtMin, { creatures: s.creatures, plants: this.plants.plants, leftovers, light, airstone: s.airstone, counts });

    // Ön cam yosunu büyür
    const algaeRate = (0.0025 + s.water.algae / 100 * 0.03) * light * (dtMin / 60);
    if (algaeRate > 0) {
      for (let y = 0; y < ALGAE_GRID.h; y++) {
        const bias = 0.6 + Math.max(0, 1 - y / ALGAE_GRID.h) * 0.9;
        for (let x = 0; x < ALGAE_GRID.w; x++) {
          const i = y * ALGAE_GRID.w + x;
          const nb = this.algaeGrid[i] > 0.05 ? 1.6 : 1;
          this.algaeGrid[i] = Math.min(1, this.algaeGrid[i] + algaeRate * bias * nb * (0.3 + Math.random() * 1.4));
        }
      }
      this.algaeDirty = true;
    }

    // Rahat mod: sağlığı tükenen canlı bakım merkezine gider
    for (const c of [...this.creatures]) {
      if (c.data.health <= 0) {
        this.removeCreature(c);
        s.care.push({ data: { ...c.data, health: 50, hunger: 20, stress: 40 }, until: s.minutes + 6 * 60 });
        this.toast(`${c.data.name} bakım merkezine alındı. Suyu iyileştir; 6 saat sonra geri dönecek.`, 'warn');
      }
    }
    for (const e of [...s.care]) {
      if (s.minutes >= e.until && quality(s.water) > 60) {
        s.care.splice(s.care.indexOf(e), 1);
        e.data.pos = [0, TANK.water - 4, 5];
        this.addCreature(e.data);
        this.toast(`${e.data.name} bakım merkezinden sağlıkla döndü!`, 'good');
      }
    }

    // Sağlıklı seri
    const healthy = quality(s.water) > 70 && this.creatures.length > 0 && this.creatures.every((c) => c.data.health > 70);
    s.counters.healthyMin = healthy ? s.counters.healthyMin + dtMin : 0;
    if (healthy) { this.xpAcc = (this.xpAcc ?? 0) + dtMin; if (this.xpAcc >= 30) { this.xpAcc -= 30; this.addXp(1); } }
    this.updateDisease(dtMin);
    this.updateBreeding(dtMin);

    if (!offline && this.ticks++ % 10 === 0) for (const p of this.plants.plants) this.plants.layout(p);
    this.checkQuests();
  }

  checkQuests() {
    const q = currentQuest(this.state);
    if (!q) return;
    if (q.check(this)) {
      this.state.coins += q.reward;
      this.state.questIndex++;
      this.addXp(q.reward);
      if (q.unlock) {
        this.state.unlocked[q.unlock] = true;
        this.toast(`Yeni tür açıldı: ${SPECIES[q.unlock].name}`, 'good');
      }
      this.emit('quest', { done: q, next: currentQuest(this.state) });
    }
  }

  discover(id, text) {
    if (this.state.discoveries.includes(id)) return;
    this.state.discoveries.push(id);
    this.toast('Gözlem: ' + text, 'discover');
    this.addXp(20);
  }

  // ----------------------------------------------------------------- Eylemler
  doWaterChange(frac) {
    waterChange(this.state, frac, this.state.creatures);
    this.state.counters.waterChanges++;
    this.sfx('waterChange', { frac });
    for (const c of this.creatures) c.scare?.(new THREE.Vector3(0, TANK.water, 0), 0.3);
    if (frac > 0.3) this.toast(`%${Math.round(frac * 100)} su değişimi büyük geldi; balıklar strese girdi.`, 'warn');
    else this.toast(`%${Math.round(frac * 100)} su değiştirildi. Kalkan tortu birazdan çökecek.`, 'good');
  }

  buy(kind, key) {
    const item = kind === 'plant' ? PLANT_TYPES[key] : SPECIES[key];
    if (this.state.coins < item.price) { this.toast('Yeterli bakım paran yok.', 'warn'); return false; }
    if (kind === 'creature') {
      if (!this.isUnlocked(key)) return false;
      if (this.creatures.length >= TANK.cap) { this.toast('Bu tank için canlı sayısı sınırına ulaştın.', 'warn'); return false; }
      this.state.coins -= item.price;
      const c = this.spawn(key);
      this.toast(`${c.data.name} (${item.name}) tanka eklendi.`, 'good');
      return true;
    }
    this.setMode('plant:' + key);
    return true;
  }

  upgradeTank(key) {
    const t = TANKS[key];
    if (!t || key === TANK.key) return false;
    if (this.level < (t.level ?? 1)) { this.toast(`${t.name} Doğa Seviyesi ${t.level} ile açılır.`, 'warn'); return false; }
    if (this.state.coins < t.price) { this.toast('Yeterli bakım paran yok.', 'warn'); return false; }
    this.state.coins -= t.price;
    // Bitki ve canlıları yeni tankın oranlarına taşı; dekor da aynı oranla yayılır
    const kx = t.w / TANK.w, kz = t.d / TANK.d, ky = t.water / TANK.water;
    const s = this.serialize();
    for (const p of s.plants) {
      const onSand = Math.abs(p.y - (sandHeight(p.x, p.z) - 0.3)) < 0.05;
      p.x *= kx; p.z *= kz;
      p.y = onSand ? null : p.y * ky;
    }
    for (const c of s.creatures) if (c.pos) c.pos = [c.pos[0] * kx, c.pos[1] * ky, c.pos[2] * kz];
    s.tank = key;
    s.algae = new Array(this.algaeGrid.length).fill(0);
    s.water.waste *= TANK.vol / ((t.w * t.d * t.water) / (60 * 30 * 33));
    s.counters.tankUpgrades = (s.counters.tankUpgrades ?? 0) + 1;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { return false; }
    this.save = () => {};
    this.emit('tankmove', t);
    setTimeout(() => location.reload(), 900);
    return true;
  }

  setMode(m) {
    this.mode = m;
    this.controls.enabled = m !== 'wipe' && m !== 'feed';
    this.feeder.group.visible = m === 'feed';
    this.feeder.pouring = false;
    if (m === 'feed' && !this.feederPlaced) this.moveFeeder(0, HALF_D);
    this.ghost.visible = m.startsWith('plant:');
    this.canvas.style.cursor = m === 'feed' ? 'crosshair' : m === 'wipe' ? 'grab' : m.startsWith('plant:') ? 'copy' : '';
    this.emit('mode', m);
  }

  select(c) {
    if (this.selected?.u) this.selected.u.uHighlight.value = 0;
    this.selected = c;
    this.follow = false;
    if (c) {
      c.u.uHighlight.value = 1;
      this.state.counters.inspected++;
    }
    this.emit('select', c);
  }

  setPhoto(on) {
    this.photo = on;
    this.fx.bokeh.enabled = on;
    const c = this.controls;
    if (on) {
      this.savedLimits = { d: c.minDistance };
      c.minDistance = 12;
    } else if (this.savedLimits) {
      c.minDistance = this.savedLimits.d;
    }
    this.emit('photo', on);
  }

  capture() {
    this.renderFrame();
    const url = this.renderer.domElement.toDataURL('image/png');
    this.state.counters.photos++;
    this.sfx('shutter');
    const a = document.createElement('a');
    a.href = url;
    a.download = `vivarium-gun${this.day}-${String(Math.floor(this.hour)).padStart(2, '0')}.png`;
    a.click();
    return url;
  }

  // -------------------------------------------------------------------- Girdi
  rayFromEvent(e) {
    const r = this.canvas.getBoundingClientRect();
    _ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    _ray.setFromCamera(_ndc, this.camera);
    return _ray.ray;
  }

  surfacePoint(ray) {
    _plane.set(new THREE.Vector3(0, 1, 0), -TANK.water);
    if (ray.intersectPlane(_plane, _hit) && Math.abs(_hit.x) < HALF_W - 1 && Math.abs(_hit.z) < HALF_D - 1) return _hit.clone();
    _plane.set(new THREE.Vector3(0, 0, 1), -HALF_D);
    if (ray.intersectPlane(_plane, _hit) && Math.abs(_hit.x) < HALF_W && _hit.y < TANK.h + 4) return new THREE.Vector3(THREE.MathUtils.clamp(_hit.x, -HALF_W + 2, HALF_W - 2), TANK.water, 4);
    return null;
  }

  glassPoint(ray) {
    _plane.set(new THREE.Vector3(0, 0, 1), -(HALF_D + TANK.glass * 0.5));
    if (!ray.intersectPlane(_plane, _hit)) return null;
    if (Math.abs(_hit.x) > HALF_W + TANK.glass || _hit.y < -TANK.glass || _hit.y > TANK.h) return null;
    return _hit.clone();
  }

  pickCreature(ray) {
    let best = null, bd = Infinity;
    for (const c of this.creatures) {
      const d = ray.distanceToPoint(c.pos);
      const t = _hit.subVectors(c.pos, ray.origin).dot(ray.direction);
      if (d < Math.max(1.2, c.radius * 1.1) && t < bd) { bd = t; best = c; }
    }
    return best;
  }

  wipeAt(ray) {
    const p = this.glassPoint(ray);
    if (!p) return;
    const u = (p.x + HALF_W + TANK.glass) / (TANK.w + 2 * TANK.glass);
    const v = (p.y + TANK.glass) / (TANK.h + TANK.glass);
    const cx = u * ALGAE_GRID.w, cy = v * ALGAE_GRID.h;
    const R = 3.2;
    let removed = 0;
    for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      if (x < 0 || y < 0 || x >= ALGAE_GRID.w || y >= ALGAE_GRID.h) continue;
      const d = Math.hypot(x - cx, y - cy) / R;
      if (d > 1) continue;
      const i = y * ALGAE_GRID.w + x;
      const before = this.algaeGrid[i];
      this.algaeGrid[i] = Math.max(0, before - (1 - d * d) * 0.5);
      removed += before - this.algaeGrid[i];
    }
    this.state.counters.wiped += removed;
    this.algaeDirty = true;
    // camın arkasındaki balıklar biraz ürker
    if (Math.random() < 0.05) for (const c of this.creatures) if (c.pos.distanceTo(p) < 10) c.scare?.(p, 0.3);
  }

  tapGlass(p) {
    const now = this.time;
    this.taps = this.taps.filter((t) => now - t < 8);
    this.taps.push(now);
    this.state.counters.taps++;
    const strength = this.taps.length > 3 ? 1.6 : 0.8;
    for (const c of this.creatures) c.scare?.(p, strength);
    this.tank.setTap(p.x, p.y, now);
    this.sfx('tap', { strength });
    if (this.taps.length === 4) this.toast('Cama sık sık vurmak canlıları ürkütür ve strese sokar.', 'warn');
  }

  bindInput() {
    let down = null, wiping = false;
    this.canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
      if (this.mode === 'wipe') { wiping = true; this.canvas.style.cursor = 'grabbing'; this.wipeAt(this.rayFromEvent(e)); }
      if (this.mode === 'feed') { this.feederAt(e); this.feeder.pouring = true; this.pourLanded = false; this.canvas.setPointerCapture?.(e.pointerId); }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (wiping) { this.wipeAt(this.rayFromEvent(e)); this.wiping = true; clearTimeout(this.wipeStop); this.wipeStop = setTimeout(() => { this.wiping = false; }, 90); }
      if (this.mode === 'feed') this.feederAt(e);
      if (this.mode.startsWith('plant:')) {
        this.rayFromEvent(e);
        const h = _ray.intersectObject(this.substrate.sand, false)[0];
        if (h) {
          this.ghost.position.copy(h.point).y += 0.15;
          this.ghost.visible = true;
          this.ghost.material.color.set(this.plantBlocked(this.mode.slice(6), h.point.x, h.point.z) ? 0xff8a7a : 0xbfffd8);
        } else this.ghost.visible = false;
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (wiping) { wiping = false; this.wiping = false; this.canvas.style.cursor = 'grab'; }
      this.feeder.pouring = false;
      if (!down || e.target !== this.canvas) { down = null; return; }
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 6) return;
      this.click(e);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (this.photo) this.setPhoto(false); else { this.setMode('view'); this.select(null); } }
      if (e.key === ' ' && this.photo) { e.preventDefault(); this.capture(); }
    });
  }

  click(e) {
    const ray = this.rayFromEvent(e);
    if (this.mode === 'feed') return;
    if (this.mode.startsWith('plant:')) {
      const type = this.mode.slice(6);
      const h = _ray.intersectObject(this.substrate.sand, false)[0];
      if (!h) return;
      const why = this.plantBlocked(type, h.point.x, h.point.z);
      if (why) { this.toast(why, 'warn'); return; }
      const price = PLANT_TYPES[type].price;
      if (this.state.coins < price) { this.toast('Yeterli bakım paran yok.', 'warn'); this.setMode('view'); return; }
      this.state.coins -= price;
      this.addPlant(type, h.point.x, h.point.z, { growth: 0.45 });
      this.state.counters.planted++;
      this.sfx('plant');
      this.toast(`${PLANT_TYPES[type].name} dikildi. Işık aldıkça büyüyecek.`, 'good');
      for (const c of this.creatures) if (c.pos.distanceTo(h.point) < 8) c.scare?.(h.point, 0.4);
      this.setMode('view');
      return;
    }
    if (this.mode === 'view') {
      const c = this.pickCreature(ray);
      if (c) { this.select(c); return; }
      const g = this.glassPoint(ray);
      if (g && this.camera.position.z > HALF_D) this.tapGlass(g);
      else this.select(null);
    }
  }

  // Dar (dikey) ekranlarda tankın tamamı görünsün: kamerayı uzaklaştır
  fitTank() {
    const aspect = this.camera.aspect;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const need = Math.max(108 * TANK.sx ** 0.3, (TANK.w / 2 + 8) / Math.tan(hfov / 2), (TANK.h * 0.6 + 4) / Math.tan(vfov / 2));
    this.controls.maxDistance = Math.min(215, Math.max(170, need * 1.4));
    if (this.photo) return;
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.length() < need * 0.98 || aspect < 1) dir.setLength(need);
    this.camera.position.copy(this.controls.target).add(dir);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.fx.setSize(w, h);
    this.reflection.setSize(w, h);
    for (const m of this.mirrors) m.setSize(w, h);
    this.fitTank();
  }

  // ---------------------------------------------------------------- Döngü
  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    WU.uTime.value = this.time;
    const dtMin = dt * GAME_MIN_PER_SEC * this.speed;

    this.updateLighting(dtMin);
    this.simAcc += dtMin;
    this.ticks ??= 0;
    while (this.simAcc >= 1) { this.simStep(1); this.simAcc -= 1; }

    // Su görünümünü sim değerlerine bağla
    const w = this.state.water;
    const leftovers = this.food.filter((f) => f.state === 'settled').length;
    WU.uTurbidity.value = THREE.MathUtils.lerp(WU.uTurbidity.value, turbidity(w, leftovers), 0.02);
    WU.uAlgae.value = THREE.MathUtils.lerp(WU.uAlgae.value, Math.min(1, w.algae / 70), 0.02);
    WU.uCaustic.value = 1;

    // Okul (sürü) hedefleri
    for (const [key, sc] of Object.entries(this.school)) {
      sc.timer -= dt;
      sc.excite = Math.max(0, sc.excite - dt * 0.15);
      if (sc.timer < 0) {
        sc.timer = 5 + Math.random() * 7;
        const sp = SPECIES[key];
        const x = (Math.random() - 0.5) * (TANK.w - 14), z = (Math.random() - 0.5) * (TANK.d - 10);
        const floor = sandHeight(x, z);
        const night = this.night > 0.5 ? 0.3 : 0;
        sc.target.set(x, floor + 3 + (TANK.water - floor - 6) * Math.max(0, sp.depth[0] - night + Math.random() * (sp.depth[1] - sp.depth[0])), z);
      }
    }

    const bdt = dt * Math.min(this.speed, 3);
    const world = {
      fish: this.creatures,
      food: this.food,
      obstacles: this.allObstacles(),
      night: this.night,
      o2: w.o2,
      plants: this.plants.plants,
      events: this.events,
      counts: this.counts(),
      school: this.school,
      algae: w.algae / 100,
      cleanGlass: (x, y, a) => this.cleanGlass(x, y, a),
    };
    for (const c of this.creatures) c.update(bdt, world);
    this.updateFood(bdt, dtMin);
    if (this.feeder.group.visible) {
      // el imleci takip eder ama ani sıçramaz
      this.feeder.group.position.lerp(this.feederTarget, Math.min(1, dt * 14));
      this.feeder.update(dt, (p) => this.emitFlake(p));
    }

    for (const ev of this.events) {
      if (ev.type === 'eat') this.sfx('eat');
      if (ev.type === 'snailGlass') this.discover('snailGlass', 'Nerit salyangoz camdaki yosunu radula denen törpü dilleriyle kazıyor.');
      if (ev.type === 'flare') this.discover('bettaFlare', 'Erkek betalar rakibe solungaç kapaklarını ve yüzgeçlerini açarak gözdağı verir.');
      if (ev.type === 'nip' && this.time - (this.lastNip ?? -99) > 30) {
        this.lastNip = this.time;
        this.toast(`${ev.fish.data.name} (${ev.fish.sp.name}), ${ev.target.data.name} adlı balığın yüzgecini ısırdı. Bu türler birlikte stres yaşıyor.`, 'warn');
      }
      if (ev.type === 'predation' && this.creatures.includes(ev.target)) {
        const t = ev.target;
        this.removeCreature(t);
        this.state.care.push({ data: { ...t.data, health: 40, stress: 60 }, until: this.state.minutes + 12 * 60 });
        this.toast(`${ev.fish.data.name} (${ev.fish.sp.name}) ${t.data.name} adlı ${t.sp.name.toLowerCase()} türünü avlamaya çalıştı! Rahat modda ${t.data.name} bakım merkezine kaçırıldı. Bu türleri ayrı tutmayı düşün.`, 'warn');
        this.discover('angelHunt', 'Melek balıkları, ağızlarına sığan küçük balıkları doğada da avlar.');
      }
      if (ev.type === 'coryAir') this.discover('coryAir', 'Corydoras bağırsağıyla da nefes alabilir; yüzeye fırlayıp hava yuttu!');
    }
    this.events.length = 0;
    if (this.night > 0.8 && this.creatures.some((c) => c.state === 'sleep')) {
      this.discover('nightNeon', this.count('neon') ? 'Neon tetraların şeridi gece solar; dinlenirken renklerini kısarlar.' : 'Balıklar gece yavaşlayıp tabana yakın dinleniyor.');
    }

    // Kabarcıklar ve hava taşı
    this.bubbles.userData.enabled = this.state.airstone;
    this.bubbles.userData.update(dt, 0);
    // yüzeye yakın yüzen balıklar ve yüzen yemler suyu kıpırdatır
    for (const c of this.creatures) {
      if (c.pos.y > TANK.water - 1.6 && Math.random() < dt * 14) {
        this.waterSim.drop(c.pos.x, c.pos.z, 0.5 + (c.sp.size ?? 3) * 0.12, -0.012 - Math.random() * 0.012);
      }
    }
    this.waterSim.update(dt);
    this.godrays.userData.update(this.camera, this.time);

    if (this.algaeDirty && Math.floor(this.time * 10) % 2 === 0) {
      const d = this.tank.algaeData;
      for (let i = 0; i < d.length; i++) d[i] = Math.round(this.algaeGrid[i] * 255);
      this.tank.algaeTex.needsUpdate = true;
      this.algaeDirty = false;
    }

    if (this.follow && this.selected) {
      this.controls.target.lerp(this.selected.pos, 0.06);
    } else if (!this.photo) {
      this.controls.target.lerp(new THREE.Vector3(0, TANK.h * 0.42, 0), 0.02);
    }
    if (this.photo) {
      const center = this.selected ? this.selected.pos : this.controls.target;
      const fd = this.camera.position.distanceTo(center);
      this.fx.bokeh.uniforms.focus.value = fd;
    }
    this.controls.update();
  }

  renderFrame() {
    this.reflection.update(this.camera);
    this.updateMirrors();
    this.fx.render(this.time);
  }

  updateMirrors() {
    if (!this.mirrors.length) return;
    const c = this.camera.position;
    const g = TANK.glass * 0.5;
    // Kamera hangi camdan bakıyor? Ona dik iki cam ayna olur.
    const alongZ = Math.abs(c.z) / HALF_D > Math.abs(c.x) / HALF_W;
    const planes = alongZ
      ? [[new THREE.Vector3(1, 0, 0), new THREE.Vector3(-HALF_W - g, 0, 0)], [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(HALF_W + g, 0, 0)]]
      : [[new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -HALF_D - g)], [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, HALF_D + g)]];
    this.mirrorFrame++;
    planes.forEach(([n, p], i) => {
      // Telefonda iki ayna sırayla güncellenir
      const cam = c.clone().sub(p).dot(n) > 0;
      MIRROR_U['uMirOn' + i].value = cam ? 1 : 0;
      if (!cam || (MOBILE && this.mirrorFrame % 2 !== i)) return;
      const m = this.mirrors[i];
      m.update(this.camera, n, p);
      MIRROR_U['uMirMat' + i].value.copy(m.textureMatrix);
      MIRROR_U['uMirPlane' + i].value.set(n.x, n.y, n.z, n.dot(p));
    });
  }

  glassAlgae() {
    let s = 0;
    for (const v of this.algaeGrid) s += v;
    return s / this.algaeGrid.length;
  }
}
