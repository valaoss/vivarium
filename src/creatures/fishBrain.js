import * as THREE from 'three';
import { curve } from '../eco/Brain.js';
import { TANK, HALF_W, HALF_D } from '../config.js';
import { sandHeight } from '../world/substrate.js';

// Akvaryum balıklarının tür profilleri ve ortak eylem repertuvarı.
// Her tür yalnızca biyolojisine uyan eylemleri alır (profile bayrakları); puanlar balığın kendi
// ihtiyaçları, algıladıkları ve hafızasıyla hesaplanır. Ayrıntılar: docs/species/aquarium-fish.md
//
// night:  gece duruşu — 'hover' (orta suda asılı, renk solar), 'bottom' (tabana çöker), 'leaf' (yüzeye yakın
//         yaprakta yaslanır), 'glass' (cama / yaprağa yapışır), 'active' (gece etkin)
// air:    'labyrinth' (labirent organı: düzenli yüzey nefesi, zorunlu), 'gut' (bağırsak solunumu: ara sıra
//         yüzeye fırlama), yoksa yalnızca oksijen düşünce yüzeyde soluma (ASR)
export const FISH_PROFILES = {
  neon: { shoal: 0.85, night: 'hover', fade: 1, timid: 0.7 },
  cardinal: { shoal: 0.9, night: 'hover', fade: 1, timid: 0.7 },
  rasbora: { shoal: 0.95, night: 'hover', timid: 0.55 },
  barb: { shoal: 0.55, night: 'hover', court: 'display', timid: 0.5 },
  danio: { shoal: 0.7, night: 'hover', dawnChase: true, timid: 0.3, restless: 1 },
  guppy: { shoal: 0.25, night: 'hover', court: 'sigmoid', grazer: 0.2, timid: 0.3 },
  platy: { shoal: 0.2, night: 'bottomish', court: 'chase', grazer: 0.5, timid: 0.35 },
  molly: { shoal: 0.2, night: 'bottomish', court: 'chase', grazer: 0.8, timid: 0.35 },
  swordtail: { shoal: 0.2, night: 'hover', court: 'chase', spar: true, timid: 0.3 },
  betta: { shoal: 0, night: 'leaf', air: 'labyrinth', territorial: true, mirror: true, nest: true, timid: 0.15 },
  gourami: { shoal: 0, night: 'leaf', air: 'labyrinth', nest: true, feelers: true, timid: 0.6 },
  angel: { shoal: 0.2, night: 'hover', predator: { prey: ['neon', 'cardinal', 'shrimp', 'amano'], ratio: 0.45 }, hierarchy: true, timid: 0.25 },
  cory: { shoal: 0.75, night: 'bottom', air: 'gut', bottomFeeder: true, timid: 0.45 },
  kuhli: { shoal: 0.35, night: 'active', hideDay: true, bottomFeeder: true, timid: 0.9 },
  oto: { shoal: 0.5, night: 'glass', grazer: 1, timid: 0.6 },
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const pick = (f, a, b) => a + f.rand() * (b - a);
const lit = (f) => 1 - f.world.night;
// türün tercih ettiği derinlikte rastgele bir nokta (gece daha aşağı)
export function zonePoint(f, out = new THREE.Vector3(), opts = {}) {
  const sp = f.sp, m = 4;
  const x = opts.x ?? (f.rand() - 0.5) * (TANK.w - m * 2);
  const z = opts.z ?? (f.rand() - 0.5) * (TANK.d - m * 2);
  const floor = sandHeight(x, z);
  let [d0, d1] = sp.depth;
  if (f.world.night > 0.5) { d0 = Math.max(0, d0 - 0.25); d1 = Math.max(d0 + 0.1, d1 - 0.35); }
  let y = floor + 2 + (TANK.water - 2 - floor - 2) * (d0 + f.rand() * (d1 - d0));
  if (sp.bottom) y = floor + sp.body.height * 0.55;
  return out.set(x, y, z);
}

// ------------------------------------------------------------------ yüzme / keşif
const cruise = {
  id: 'cruise', label: 'Dolaşıyor',
  score(f) {
    const P = f.prof;
    let v = 0.3 * (lit(f) * 0.8 + 0.2) * (P.night === 'active' ? 0.3 + f.world.night : 1) + (P.restless ?? 0) * 0.1;
    if (P.hideDay && f.world.night < 0.4) v *= 0.3;
    return [v, f.world.night > 0.5 ? 'gece gezintisi' : 'kendi derinliğinde dolaşıyor'];
  },
  start(f) { f.goal = cruiseGoal(f); f.goalT = pick(f, 5, 12); },
  tick(f, dt) {
    f.goalT -= dt;
    if (f.pos.distanceTo(f.goal) < 2.5 || f.goalT < 0) { f.goal = cruiseGoal(f); f.goalT = pick(f, 5, 12); }
    f.state = f.sp.bottom ? 'forage' : 'wander';
    f.note = f.sp.bottom ? 'Tabanda kesik kesik ilerliyor' : 'Kendi su katmanında yüzüyor';
    return 'run';
  },
};

// bölgeci tür (beta) sınırlarını camın kenarı boyunca devriye gezerek kollar
function cruiseGoal(f) {
  const g = zonePoint(f, new THREE.Vector3());
  if (f.prof.territorial && f.rand() < 0.45) {
    if (f.rand() < 0.6) g.z = Math.sign(f.rand() - 0.3) * (HALF_D - 3.5);
    else g.x = Math.sign(f.rand() - 0.5) * (HALF_W - 3.5);
  }
  return g;
}

// sürü: yalnızca gördüğü hemcinslerine uyum; tehlikede sıkılaşır
const shoal = {
  id: 'shoal', label: 'Sürüyle yüzüyor',
  when: (f) => f.prof.shoal > 0.3,
  score(f) {
    const n = f.mates.length;
    if (n < 1) return [0.05, 'görünürde hemcinsi yok'];
    const v = f.prof.shoal * (0.45 + Math.min(0.35, n * 0.12)) * (0.8 + f.alarm * 0.8) * (f.world.night > 0.7 && f.prof.night !== 'active' ? 0.4 : 1);
    return [v, `${n} hemcinsini görüyor${f.alarm > 0.2 ? '; tedirgin: sıkı sürü' : ''}`];
  },
  start(f) { f.goal = zonePoint(f, new THREE.Vector3()); f.goalT = pick(f, 4, 10); },
  tick(f, dt) {
    f.goalT -= dt;
    // sürüde kimse lider değil: herkes kendi hedefine doğru ama komşularına hizalanarak yüzer
    if (f.pos.distanceTo(f.goal) < 3 || f.goalT < 0) { zonePoint(f, f.goal); f.goalT = pick(f, 4, 10); }
    f.state = 'school';
    f.note = `Komşularıyla hizalanıyor (${f.mates.length} hemcins)`;
    return 'run';
  },
};

// ------------------------------------------------------------------ beslenme
const feed = {
  id: 'feed', label: 'Yem yiyor', emergency: true,
  when: (f) => !!f.food || f.feedLocked(),
  score(f) {
    if (f.feedLocked()) return [1, 'yem ağzında'];
    const h = f.data.hunger;
    const v = curve.lin(h, 3, 40) * 0.75 + 0.2 + (f.data.trait === 'Obur' ? 0.1 : 0);
    return [Math.min(1, v), `${f.food.how}; açlık ${h | 0}`];
  },
  lock: (f) => f.feedLocked(),
  inertia: 1.3,
  tick(f) {
    const fe = f.feed;
    let target = f.food?.item;
    if (target && (target.eaten || (target.held && target.held !== f))) target = null;
    if (!fe && !target) return 'done';
    f.state = fe && (fe.phase === 'hold' || fe.phase === 'spit') ? 'eat' : 'seek';
    f.foodTarget = target ?? null;
    f.note = fe ? { approach: 'Yeme yaklaşıyor', aim: 'Durup nişan alıyor', strike: 'Ağzını açıp emiyor', hold: 'Ağzında tutuyor, çiğniyor', spit: 'Büyük pulu tükürdü' }[fe.phase] : 'Yeme yöneldi';
    return 'run';
  },
  end(f) { f.foodTarget = null; },
};

// yem saati beklentisi: o saatte yemin düştüğü yere toplanır
const anticipate = {
  id: 'anticipate', label: 'Yem bekliyor',
  score(f) {
    const k = f.feedExpectation();
    return [k * curve.lin(f.data.hunger, 10, 50) * 0.7, `genelde bu saatte yem geliyor (beklenti ${(k * 100) | 0}%)`];
  },
  start(f) { const m = f.recall('feedSpot'); f.goal = m ? m.pos.clone() : new THREE.Vector3(0, TANK.water - 3, HALF_D - 6); },
  tick(f) {
    const g = f.goal;
    g.y = f.sp.bottom ? sandHeight(g.x, g.z) + 1 : Math.min(TANK.water - 2.5, g.y);
    f.state = 'wait';
    f.note = 'Yemin düştüğü yerde yukarıya bakıp bekliyor';
    return 'run';
  },
};

// tabanda eşeleme: bıyıklarla kumu yoklar (kory, kuhli)
const root = {
  id: 'root', label: 'Kumu eşeliyor',
  when: (f) => !!f.prof.bottomFeeder,
  score(f) {
    const v = (0.3 + curve.lin(f.data.hunger, 10, 60) * 0.35) * (f.prof.hideDay && f.world.night < 0.4 ? 0.2 : 1) * (f.world.night > 0.7 && f.prof.night === 'bottom' ? 0.4 : 1);
    return [v, 'bıyıklarıyla kumun içindeki yem kırıntılarını yokluyor'];
  },
  start(f) { f.goal = zonePoint(f, new THREE.Vector3()); f.rootT = 0; },
  tick(f, dt) {
    f.rootT -= dt;
    if (f.rootT < 0) { f.rooting = !f.rooting; f.rootT = f.rooting ? pick(f, 1.5, 4) : pick(f, 0.8, 2); if (!f.rooting && f.rand() < 0.5) zonePoint(f, f.goal); }
    f.state = f.rooting ? 'root' : 'forage';
    f.note = f.rooting ? 'Burnunu kuma gömüp eşeliyor' : 'Kısa bir sekişle yer değiştiriyor';
    return 'run';
  },
  end(f) { f.rooting = false; },
};

// yosun kazıma: oto camda / yaprakta, moli ve plati yüzeylerden didikler
const graze = {
  id: 'graze', label: 'Yosun kazıyor',
  when: (f) => (f.prof.grazer ?? 0) > 0,
  score(f) {
    const v = f.prof.grazer * (0.15 + f.world.algae * 0.4 + curve.lin(f.data.hunger, 5, 50) * 0.45) * (f.world.night > 0.7 ? 0.4 : 1) * (f.grazeRest > 0 ? 0.4 : 1);
    return [v, `yosun yoğunluğu ${(f.world.algae * 100) | 0}%`];
  },
  start(f) { f.goal = grazeSpot(f); f.grT = pick(f, 8, 25); },
  tick(f, dt) {
    f.grT -= dt;
    f.state = 'graze';
    f.note = f.prof.grazer >= 1 ? 'Vantuz ağzıyla yüzeye yapışmış, yosunu kazıyor' : 'Yüzeylerdeki yosunu didikliyor';
    if (f.pos.distanceTo(f.goal) < 1.6) {
      if (f.prof.grazer >= 1) f.world.cleanGlass?.(f.goal.x, f.goal.y, 0.02 * dt);
      f.data.hunger = Math.max(0, f.data.hunger - dt * 0.25 * (0.2 + f.world.algae) * f.prof.grazer);
    }
    return f.grT < 0 ? 'done' : 'run';
  },
  end(f) { f.grazeRest = 20 + f.rand() * 40; },
};
function grazeSpot(f) {
  // ön / arka cam ya da bir bitki yaprağı
  if (f.rand() < 0.6) {
    const z = f.rand() < 0.5 ? HALF_D - 1.3 : -HALF_D + 1.3;
    return new THREE.Vector3((f.rand() - 0.5) * (TANK.w - 10), 3 + f.rand() * (TANK.water - 7), z);
  }
  const pl = f.world.plants?.[Math.floor(f.rand() * (f.world.plants?.length || 1))];
  return pl ? new THREE.Vector3(pl.x + (f.rand() - 0.5) * 2, sandHeight(pl.x, pl.z) + 3 + f.rand() * 6, pl.z + (f.rand() - 0.5) * 2) : zonePoint(f);
}

// ------------------------------------------------------------------ dinlenme / uyku (türüne göre)
const sleep = {
  id: 'sleep', label: 'Uyuyor',
  score(f) {
    const P = f.prof;
    if (P.night === 'active') return [f.world.night < 0.4 ? 0 : 0, ''];
    const v = curve.lin(f.world.night, 0.4, 0.9) * 0.85;
    return [v, 'ışıklar söndü: dinlenme saati'];
  },
  start(f) {
    const P = f.prof;
    // uyku yeri: bitki arası (tetra), taban (kory), yüzeye yakın yaprak (beta), cam / yaprak (oto)
    const plants = f.world.plants ?? [];
    const pl = plants.length ? plants[Math.floor(f.rand() * plants.length)] : null;
    if (P.night === 'leaf' && pl) f.goal = new THREE.Vector3(pl.x, Math.min(TANK.water - 3, sandHeight(pl.x, pl.z) + 10), pl.z);
    else if (P.night === 'glass') f.goal = grazeSpot(f);
    else if (P.night === 'bottom' || P.night === 'bottomish') { const p = zonePoint(f); f.goal = p.setY(sandHeight(p.x, p.z) + (P.night === 'bottom' ? f.sp.body.height * 0.5 : 2.5)); }
    else if (pl) f.goal = new THREE.Vector3(pl.x + (f.rand() - 0.5) * 4, sandHeight(pl.x, pl.z) + 3 + f.rand() * 5, pl.z + (f.rand() - 0.5) * 4);
    else f.goal = zonePoint(f);
  },
  tick(f) {
    f.state = 'sleep';
    f.note = { leaf: 'Yüzeye yakın bir yaprağa yaslanmış dinleniyor', bottom: 'Tabana çökmüş, yüzgeçleriyle dayanıyor', glass: 'Bir yüzeye yapışmış hareketsiz', hover: 'Bitkiler arasında asılı; renkleri soldu' }[f.prof.night] ?? 'Dinleniyor';
    return 'run';
  },
};

// kuhli: gündüz kuytuda / kum içinde saklanır
const hideDay = {
  id: 'hideDay', label: 'Saklanıyor',
  when: (f) => !!f.prof.hideDay,
  score(f) { return [f.world.night < 0.4 ? 0.7 : 0.05, 'gündüz: kuytuda saklanır (gececi)']; },
  start(f) { const s = f.recall('shelter', (m) => m.value - m.pos.distanceTo(f.pos) * 0.03); f.goal = s ? s.pos.clone() : zonePoint(f); },
  tick(f) { f.state = 'hide'; f.note = 'Dekorun dibinde, kumun kenarına sokulmuş'; return 'run'; },
};

// ------------------------------------------------------------------ nefes
const breathe = {
  id: 'breathe', label: 'Yüzeyden hava alıyor', emergency: true,
  score(f) {
    const P = f.prof, o2 = f.world.o2;
    if (P.air === 'labyrinth') return [curve.lin(f.airNeed, 0.7, 1.2) * 0.95, 'labirent organı: suyun üstünden hava solur'];
    if (P.air === 'gut') return [f.airNeed >= 1 ? 0.92 : 0, 'bağırsak solunumu: yüzeye fırlayıp hava yutar'];
    return [o2 < 32 ? curve.inv(o2, 15, 32) * 0.9 + 0.1 : 0, `sudaki oksijen ${o2 | 0}: yüzeyde soluyor`];
  },
  lock: (f) => f.prof.air === 'gut' && f.airPhase > 0,
  start(f) { f.airPhase = 1; f.goal = new THREE.Vector3(f.pos.x, TANK.water - 1, f.pos.z); f.gulpT = 0; },
  tick(f, dt) {
    f.state = 'air';
    const P = f.prof;
    if (P.air === 'gut') { f.note = f.airPhase === 1 ? 'Yüzeye fırlıyor' : 'Hava yuttu, dibe dönüyor'; if (f.airPhase === 0) { f.airNeed = 0; return 'done'; } return 'run'; }
    // yüzgeç payı: uzun sırt yüzgeçli balık gövdesini yüzeye o kadar yaklaştıramaz, ağzı yine de değer
    const fin = (f.localBox?.max.y ?? 0.5) * f.group.scale.x;
    if (f.pos.y > TANK.water - 1.4 - fin) {
      f.gulpT += dt;
      f.mouthTarget = f.gulpT < 0.25 ? 0.9 : 0;
      if (f.gulpT > 0.25 && !f.gulped) { f.gulped = true; f.airNeed = 0; f.world.events.push({ type: 'gulp', fish: f }); }
      f.note = 'Ağzını yüzeye değdirip hava yutuyor';
      if (f.gulpT > 0.8) return 'done';
    } else f.note = 'Yüzeye çıkıyor';
    return 'run';
  },
  end(f) { f.gulped = false; if (f.prof.air !== 'gut') f.airPhase = 0; },
};

// ------------------------------------------------------------------ korku
const flee = {
  id: 'flee', label: 'Kaçıyor', emergency: true,
  score(f) { return [f.flee > 0 ? 1 : 0, f.fleeWhy ?? 'ani tehlike']; },
  lock: (f) => f.flee > 0,
  tick(f) { f.state = 'flee'; f.note = 'C-başlangıcıyla fırladı, uzaklaşıyor'; return f.flee > 0 ? 'run' : 'done'; },
};
const cover = {
  id: 'cover', label: 'Bitkilere sığınıyor',
  score(f) {
    const v = Math.max(curve.lin(f.data.stress, 45, 90), f.alarm * 0.9) * (0.4 + f.prof.timid * 0.6);
    return [v, f.threat ? `${f.threat.why}` : `stres ${f.data.stress | 0}`];
  },
  start(f) {
    const s = f.recall('shelter', (m) => m.value - m.pos.distanceTo(f.pos) * 0.04 - (f.threat ? (m.pos.distanceTo(f.threat.pos) < 8 ? 3 : 0) : 0));
    f.goal = s ? s.pos.clone() : zonePoint(f);
  },
  tick(f) { f.state = 'hide'; f.note = 'Yoğun bitkilerin arasına sokuluyor'; return 'run'; },
};

// ------------------------------------------------------------------ sosyal: bölge, hiyerarşi, kur, av
const territory = {
  id: 'territory', label: 'Bölgesini koruyor',
  when: (f) => !!f.prof.territorial && !!f.rival,
  score(f) {
    const r = f.rival;
    const mir = r.mirror;
    const v = (mir ? 0.35 : 0.65) * r.conf * (f.world.night > 0.6 ? 0.2 : 1) * (1 - curve.lin(f.data.hunger, 50, 90) * 0.5);
    return [v, mir ? 'camdaki kendi yansımasını rakip sanıyor' : `rakip: ${r.e.data.name} (${r.e.sp.name})`];
  },
  inertia: 1.3,
  start(f) { f.dispT = 0; f.dispDur = pick(f, 4, 9); },
  tick(f, dt) {
    const r = f.rival;
    if (!r) return 'done';
    f.dispT += dt;
    f.prey = r.mirror ? null : r.e;
    f.mirrorPt = r.mirror ? r.pos : null;
    f.state = r.mirror || r.e.species === f.species ? 'flare' : 'chase';
    f.note = r.mirror ? 'Cama dönük; solungaç kapaklarını ve yüzgeçlerini açmış' : f.state === 'flare' ? 'Yan yana gösteriş: yüzgeçler gergin' : 'Rakibini kovalıyor';
    return f.dispT > f.dispDur ? 'done' : 'run';
  },
  end(f) { f.prey = null; f.mirrorPt = null; f.rivalCooldown = 20 + f.rand() * 30; },
};

const court = {
  id: 'court', label: 'Kur yapıyor',
  when: (f) => !!f.prof.court && f.data.sex === 'm' && !f.data.fry && !!f.mate,
  score(f) {
    const v = 0.65 * Math.sqrt(f.mate.conf) * lit(f) * (1 - curve.lin(f.data.hunger, 40, 80)) * (f.prof.court === 'sigmoid' ? 1.15 : 1);
    return [v, `dişi ${f.mate.e.data.name} yakında`];
  },
  start(f) { f.crT = 0; f.crDur = pick(f, 3, 8); },
  tick(f, dt) {
    f.crT += dt;
    f.prey = f.mate?.e;
    f.state = 'court';
    f.note = { sigmoid: 'Dişinin önünde gövdesini S biçiminde büküp titretiyor', chase: 'Dişinin peşinden yüzüyor', display: 'Yüzgeçlerini açıp renklerini koyulaştırıyor' }[f.prof.court];
    return f.crT > f.crDur || !f.prey ? 'done' : 'run';
  },
  end(f) { f.prey = null; f.courtCooldown = 15 + f.rand() * 30; },
};

// zebra danio: şafakta erkekler dişileri kovalar (yumurtlama zamanı)
const dawnChase = {
  id: 'dawnChase', label: 'Şafak kovalamacası',
  when: (f) => !!f.prof.dawnChase && f.data.sex === 'm' && !!f.mate,
  score(f) { const h = f.world.hour; return [h >= 7.5 && h < 9.5 ? 0.6 : 0.03, 'ışıklar yeni yandı: zebra danio yumurtlama saati']; },
  start(f) { f.crT = 0; },
  tick(f, dt) { f.crT += dt; f.prey = f.mate?.e; f.state = 'chase'; f.chaseSoft = true; f.note = 'Dişinin peşinde hızlı zikzaklar'; return f.crT > pick(f, 2, 5) ? 'done' : 'run'; },
  end(f) { f.prey = null; f.chaseSoft = false; },
};

const hunt = {
  id: 'hunt', label: 'Avlanıyor', emergency: true,
  when: (f) => !!f.prof.predator && !!f.quarry,
  score(f) {
    const q = f.quarry;
    // av gece daha kolay: uyuyan küçük balık kaçamaz
    const v = curve.lin(f.data.hunger, 25, 70) * 0.8 * q.conf * (q.e.state === 'sleep' ? 1.3 : 0.8);
    return [Math.min(1, v), `${q.e.sp.name} ağzına sığacak boyda${q.e.state === 'sleep' ? ', uyuyor' : ''}`];
  },
  start(f) { f.hT = 0; },
  tick(f, dt) {
    f.hT += dt; f.prey = f.quarry?.e; f.state = 'hunt';
    f.note = 'Yavaşça süzülerek yaklaşıyor, sonra ani atak';
    return f.hT > 8 || !f.prey ? 'done' : 'run';
  },
  end(f) { f.prey = null; },
};

// ------------------------------------------------------------------ köpük yuvası (beta / gurami erkeği)
const nest = {
  id: 'nest', label: 'Köpük yuvası yapıyor',
  when: (f) => !!f.prof.nest && f.data.sex !== 'f' && !f.data.fry,
  score(f) {
    const calm = 1 - curve.lin(f.data.stress, 20, 60);
    const v = 0.45 * calm * curve.inv(f.data.hunger, 20, 60) * lit(f) * (f.world.flow > 0.5 ? 0.2 : 1) * (1 - Math.min(1, (f.nestSize ?? 0) / 1.2) * 0.5);
    return [v, `tok ve sakin${f.world.flow > 0.5 ? '; ama akıntı yuvayı dağıtıyor' : ''}`];
  },
  start(f) {
    // durgun köşe: yüzer bitki ya da yaprak altı
    const fb = (f.world.plants ?? []).find((p) => p.type === 'frogbit');
    f.nestAt = f.nestAt ?? new THREE.Vector3(fb ? fb.x : (f.rand() < 0.5 ? -1 : 1) * (HALF_W - 6), TANK.water - 0.9, fb ? fb.z : -HALF_D + 6);
    f.goal = f.nestAt.clone(); f.nT = 0;
  },
  tick(f, dt) {
    f.state = 'nest';
    f.nT += dt;
    if (f.pos.distanceTo(f.goal) < 2) {
      // ağzıyla hava yutup salgıyla kaplanmış kabarcıklar üfler
      if (f.rand() < dt * 1.5) { f.world.events.push({ type: 'nestBubble', fish: f, at: f.nestAt }); f.nestSize = Math.min(1.5, (f.nestSize ?? 0) + 0.02); }
      f.mouthTarget = 0.5 + 0.5 * Math.sin(f.nT * 8);
    }
    f.note = 'Yüzeyin altında kabarcık üflüyor';
    return f.nT > pick(f, 20, 40) ? 'done' : 'run';
  },
};

// meraklı: cama yaklaşıp dışarıyı izler
const curious = {
  id: 'curious', label: 'Seni izliyor',
  score(f) { return [f.data.trait === 'Meraklı' ? 0.22 * lit(f) : 0.05 * lit(f), 'ön camın ardında hareket görüyor']; },
  start(f) { f.goal = new THREE.Vector3((f.rand() - 0.5) * (TANK.w - 12), zonePoint(f).y, HALF_D - 3); f.cuT = 0; },
  tick(f, dt) { f.cuT += dt; f.state = 'curious'; f.note = 'Ön cama gelip dışarıya bakıyor'; return f.cuT > pick(f, 6, 14) ? 'done' : 'run'; },
};

export const FISH_ACTIONS = [cruise, shoal, feed, anticipate, root, graze, sleep, hideDay, breathe, flee, cover, territory, court, dawnChase, hunt, nest, curious];
