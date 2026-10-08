import * as THREE from 'three';
import { Brain } from './Brain.js';
import { mulberry } from '../render/textures.js';

// Bağımsız canlı ajanı: ihtiyaçlar, kişilik, algı, hafıza ve karar. Türler bunu genişletir;
// algı ve eylemler türe özgüdür, buradaki yalnızca ortak altyapıdır.
// Kural: ajan haritadaki hiçbir şeyi doğrudan bilmez; yalnızca percepts (şu an algıladıkları)
// ve mem (daha önce algılayıp hatırladıkları) üzerinden karar verir.

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class Agent {
  constructor(eco, { species, seed = Math.random() * 1e9, thinkInterval = 0.25 }) {
    this.isAgent = true;
    this.eco = eco;
    this.world = eco.world;
    this.speciesKey = species;
    this.rand = mulberry(Math.floor(seed));
    this.thinkInterval = thinkInterval;
    this.pos = new THREE.Vector3();
    this.needs = { energy: 70, water: 80, fatigue: 10, stress: 0, health: 100 };
    this.percepts = new Map();
    this.mem = { places: [], seen: new Map() };
    this.brain = new Brain([]);
    this.note = '';             // gözlem panelinde: kararın ayrıntısı / sonraki adım
    this.target = null;         // { pos, kind, e }
  }

  // Normal dağılımlı kişilik özelliği (türün ortalaması ve yayılımı ile)
  trait(mean, sd, lo = 0, hi = 1) {
    const u = Math.max(1e-6, this.rand()), v = this.rand();
    return THREE.MathUtils.clamp(mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v), lo, hi);
  }

  // ------------------------------------------------------------------ algı birleştirme
  perceive(e, sense, pos, conf, info = {}) {
    const key = e ? e.id : `${sense}:${Math.round(pos.x)}:${Math.round(pos.z)}`;
    let p = this.percepts.get(key);
    if (!p) { p = { e, pos: pos.clone(), conf: 0, senses: new Set(), t: this.eco.time, info: {} }; this.percepts.set(key, p); }
    p.pos.lerp(pos, conf >= p.conf ? 1 : 0.3);
    p.conf = Math.max(p.conf * 0.8, conf);
    p.senses.add(sense);
    Object.assign(p.info, info);
    p.t = this.eco.time;
    p.dist = p.pos.distanceTo(this.pos);
    return p;
  }
  decayPercepts(dt) {
    for (const [k, p] of this.percepts) {
      if (this.eco.time - p.t > 0.05) { p.conf -= dt * 0.9; p.senses.clear(); }
      if (p.conf <= 0 || (p.e && !p.e.alive)) this.percepts.delete(k);
    }
  }

  // ------------------------------------------------------------------ hafıza (yer belleği)
  // kind: 'shelter' | 'hunt' | 'water' | 'danger' | 'prey' | ...
  remember(kind, pos, value = 1, r = 3) {
    for (const m of this.mem.places) {
      if (m.kind === kind && m.pos.distanceTo(pos) < r) {
        m.pos.lerp(pos, 0.3); m.value = m.value * 0.7 + value; m.t = this.eco.time; m.n++;
        return m;
      }
    }
    const m = { kind, pos: pos.clone(), value, t: this.eco.time, n: 1 };
    this.mem.places.push(m);
    if (this.mem.places.length > 40) this.mem.places.sort((a, b) => b.value - a.value).length = 32;
    return m;
  }
  recall(kind, score = (m) => m.value) {
    let best = null, bs = -Infinity;
    for (const m of this.mem.places) if (m.kind === kind) { const s = score(m); if (s > bs) { bs = s; best = m; } }
    return best;
  }
  forget(dt, rate) {
    for (const m of this.mem.places) m.value *= Math.exp(-dt * rate * (m.kind === 'danger' ? 3 : 1));
    this.mem.places = this.mem.places.filter((m) => m.value > 0.03);
  }

  think(dt) {
    this.sense(dt);
    this.decayPercepts(dt);
    this.brain.decide(this);
  }
  sense() {}

  // gözlem paneli için özet
  inspect() {
    return {
      action: this.brain.current?.label ?? '—',
      reason: this.brain.reason,
      note: this.note,
      scores: this.brain.scores.slice(0, 8).map((s) => ({ label: s.a.label, v: s.v, why: s.why })),
      percepts: [...this.percepts.values()].sort((a, b) => b.conf - a.conf).slice(0, 8),
      history: this.brain.history.slice(0, 6),
      memory: this.mem.places.slice().sort((a, b) => b.value - a.value).slice(0, 6),
    };
  }
}

// ------------------------------------------------------------------ ortak duyu modelleri

// Görme: menzil, görüş açısı, ışık ve hareket. Hareketsiz küçük nesneleri zor fark eder.
export function senseVision(ag, eye, fwd, cfg, out) {
  const eco = ag.eco;
  const light = THREE.MathUtils.lerp(cfg.night, 1, eco.world.lightLevel ?? 1);
  const list = eco.query(eye, cfg.range, (e) => e !== ag && e.visible !== false);
  for (const e of list) {
    _v.subVectors(e.pos, eye);
    const d = Math.max(0.5, _v.length());
    const cos = _v.dot(fwd) / d;
    if (cos < cfg.fovCos) continue;
    const motion = Math.min(1, (e.speed ?? 0) / cfg.motionRef);
    // görünen büyüklük (açısal) × (hareket kazancı) × ışık
    const sig = ((e.size ?? 1) / d) * (cfg.still + (1 - cfg.still) * motion) * light * (0.6 + 0.4 * cos);
    if (sig < cfg.thresh) continue;
    const conf = Math.min(1, sig / (cfg.thresh * 3));
    _w.copy(e.pos);
    if (conf < 0.6) _w.x += (ag.rand() - 0.5) * d * 0.1, _w.z += (ag.rand() - 0.5) * d * 0.1;
    out?.push(ag.perceive(e, 'görme', _w, conf, { moving: motion > 0.2 }));
  }
}

// Titreşim: su yüzeyi dalgaları ve zemin titreşimi. Ajanın o ortama temas eden bacak oranı
// duyarlılığı belirler. Uzaklık ve yön tahmini sinyal gücüne göre gürültülüdür.
export function senseVibration(ag, at, cfg, contact) {
  const eco = ag.eco;
  for (const v of eco.vib) {
    if (v.src === ag) continue;
    const m = cfg[v.medium];
    if (!m) continue;
    const c = contact[v.medium] ?? 0;
    if (c <= 0) continue;
    const d = v.pos.distanceTo(at);
    const a = v.amp * Math.exp(-d / m.lambda) * c * m.gain;
    if (a < m.thresh) continue;
    const snr = a / m.thresh;
    const conf = Math.min(1, (snr - 1) * 0.5 + 0.2);
    _w.copy(v.pos);
    const err = d * 0.25 / Math.sqrt(snr);
    _w.x += (ag.rand() - 0.5) * err; _w.z += (ag.rand() - 0.5) * err;
    // av benzeri imza: uzun süren düzensiz sinyal (Bleckmann & Bender 1987: çırpınan böcek > 2 s, düzensiz)
    const preyLike = v.irregular * Math.min(1, v.dur / 0.8);
    ag.perceive(v.src?.alive ? v.src : null, `titreşim:${v.medium}`, _w, conf, { preyLike: Math.max(preyLike, 0), amp: a, medium: v.medium });
  }
}

// Kimyasal temas: bacak uçlarıyla ipek/feromon izleri (ör. dişi ipeğindeki feromon)
export function senseCues(ag, at, r, kinds, cb) {
  for (const c of ag.eco.cues) if (kinds.includes(c.kind) && c.pos.distanceTo(at) < r) cb(c);
}
