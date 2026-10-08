import { TANK } from '../config.js';
import { SPECIES } from '../creatures/species.js';
import { PLANT_TYPES } from '../world/plants.js';

export function newWater() {
  return { waste: 4, nitrate: 6, algae: 4, o2: 85, temp: 25, stir: 0 };
}

export function quality(w) {
  const q = 100 - w.waste * 1.5 - Math.max(0, w.nitrate - 20) * 0.6 - w.algae * 0.1;
  return Math.max(0, Math.min(100, q));
}

export function turbidity(w, leftovers) {
  return Math.min(1, w.waste / 32 + w.stir + leftovers * 0.006);
}

/**
 * Ekosistemi `dtMin` oyun dakikası kadar ilerletir. Render'dan bağımsızdır;
 * çevrimdışı ilerleme için de aynı fonksiyon büyük adımlarla çağrılır.
 * ctx: { creatures: data[], plants: data[], leftovers, light (0..1), airstone }
 */
export function tick(state, dtMin, ctx) {
  const h = dtMin / 60;
  const w = state.water;
  const light = ctx.light;

  let bioload = 0;
  for (const c of ctx.creatures) bioload += SPECIES[c.species].bioload;
  bioload /= TANK.vol;
  let plantMass = 0, plantUptake = 0, plantO2 = 0;
  for (const p of ctx.plants) {
    const m = p.growth * p.health;
    plantMass += m;
    plantUptake += m * PLANT_TYPES[p.type].uptake;
    plantO2 += m * PLANT_TYPES[p.type].o2;
  }
  const shrimp = ctx.creatures.filter((c) => c.species === 'shrimp').length
    + ctx.creatures.reduce((a, c) => a + (SPECIES[c.species].algaeEater ?? 0) * 2, 0);

  // Atık → filtre → nitrat
  w.waste += bioload * 0.9 * h;
  // Olgun filtre atığı hızla işler; nitrat yavaş birikir (su değişimi ~3 oyun gününde bir)
  const removed = w.waste * (1 - Math.exp(-0.8 * h));
  w.waste -= removed;
  w.nitrate += removed * 0.25;
  // Bitkiler nitrat tüketir
  w.nitrate = Math.max(0, w.nitrate - plantUptake * 0.2 * h * (0.3 + light * 0.7));

  // Yosun: fazla besin + ışık; bitkiler ve karidesler baskılar
  const algaeGrow = (0.04 * Math.max(w.nitrate - 5, 0) + ctx.leftovers * 0.05 + 0.05) * light;
  const algaeShrink = plantMass * 0.03 * light + shrimp * 0.25 + (light < 0.2 ? 0.2 : 0);
  w.algae = clamp(w.algae + (algaeGrow - algaeShrink) * h, 0, 100);

  // Oksijen
  const o2Target = clamp(
    70 + (ctx.airstone ? 22 : 0) + plantO2 * 1.5 * light - bioload * 1.8 - w.waste * 0.35 - (w.temp - 25) * 2 - (light < 0.2 ? plantMass * 0.4 : 0),
    5, 100,
  );
  w.o2 += (o2Target - w.o2) * (1 - Math.exp(-0.8 * h));

  // Su değişiminde kalkan tortu yavaşça çöker
  w.stir *= Math.exp(-1.5 * h);
  // Isıtıcı: gün içinde hafif dalgalanma
  w.temp = 25 + 0.4 * Math.sin((state.minutes / 1440) * Math.PI * 2 - 1.5);

  const q = quality(w);

  // Bitkiler
  for (const p of ctx.plants) {
    const rate = p.type === 'vallisneria' ? 0.012 : p.type === 'javafern' ? 0.006 : 0.003;
    if (light > 0.5 && p.health > 0.5) p.growth = Math.min(1.25, p.growth + rate * h * p.health * (w.nitrate > 2 ? 1 : 0.4));
    const target = clamp(1 - Math.max(0, w.algae - 45) / 70 - (w.nitrate < 1 ? 0.2 : 0) - (q < 40 ? 0.3 : 0), 0.15, 1);
    p.health += (target - p.health) * (1 - Math.exp(-0.05 * h));
  }

  // Canlılar
  let income = 0;
  for (const c of ctx.creatures) {
    const sp = SPECIES[c.species];
    c.hunger = Math.min(100, c.hunger + sp.hungerRate * h * (c.trait === 'Obur' ? 1.3 : 1));
    let dHealth = 2.5;
    if (c.hunger > 80) dHealth -= (c.hunger - 80) * 0.15;
    if (q < 55) dHealth -= (55 - q) * 0.09;
    if (w.o2 < 35 && sp.kind === 'fish') dHealth -= (35 - w.o2) * 0.12;
    if (c.stress > 75) dHealth -= 1;
    c.health = clamp(c.health + dHealth * h, 0, 100);
    let stressT = 0;
    if (q < 60) stressT += (60 - q) * 0.8;
    if (w.o2 < 40) stressT += (40 - w.o2);
    if (sp.school > 0.5 && ctx.counts[c.species] < 5) stressT += (5 - ctx.counts[c.species]) * 6;
    c.stress = clamp(c.stress + (stressT - c.stress) * (1 - Math.exp(-0.25 * h)), 0, 100);
    c.age = (c.age ?? 0) + dtMin;
    income += 0.6 * (c.health / 100) * (q > 60 ? 1 : 0.4);
  }
  state.coinFrac = (state.coinFrac ?? 0) + income * h;
  if (state.coinFrac >= 1) {
    const whole = Math.floor(state.coinFrac);
    state.coins += whole;
    state.coinFrac -= whole;
  }
  state.minutes += dtMin;
}

export function waterChange(state, frac, creatures) {
  const w = state.water;
  w.waste *= 1 - frac;
  w.nitrate *= 1 - frac;
  w.algae *= 1 - frac * 0.25;
  w.stir = Math.min(0.6, w.stir + frac * 0.7);
  w.o2 = Math.min(100, w.o2 + frac * 25);
  if (frac > 0.3) {
    for (const c of creatures) c.stress = Math.min(100, c.stress + (frac - 0.3) * 140);
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
