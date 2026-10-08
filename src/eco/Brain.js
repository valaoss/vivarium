// Fayda tabanlı karar verici (Utility AI). Her eylem kendi puanını ve gerekçesini üretir;
// en yüksek puanlı eylem seçilir. Mevcut eyleme bağlılık payı ve kilit (yarıda bırakılamayan
// eylemler: ısırık, deri değiştirme) ani ve anlamsız geçişleri engeller.

export const curve = {
  lin: (x, a = 0, b = 1) => Math.min(1, Math.max(0, (x - a) / (b - a))),
  inv: (x, a = 0, b = 1) => 1 - Math.min(1, Math.max(0, (x - a) / (b - a))),
  sig: (x, mid, k = 10) => 1 / (1 + Math.exp(-k * (x - mid))),
  bell: (x, mid, w) => Math.exp(-(((x - mid) / w) ** 2)),
};

export class Brain {
  constructor(actions) {
    this.actions = actions;
    this.current = null;
    this.since = 0;
    this.scores = [];
    this.reason = '';
    this.history = [];
  }

  // a.score(agent) → [puan 0-1, gerekçe]; a.start / a.tick(agent, dt) → 'run' | 'done' | 'fail'; a.end
  decide(agent) {
    const scores = [];
    for (const a of this.actions) {
      if (a.when && !a.when(agent)) continue;
      const [v, why] = a.score(agent);
      if (v > 0) scores.push({ a, v, why });
    }
    // bireysel farklılık: küçük gürültü, kişilik bazlı
    for (const s of scores) s.v *= 1 + (agent.rand() - 0.5) * 0.06;
    const cur = this.current;
    const cs = cur && scores.find((s) => s.a === cur);
    if (cs) cs.v = cs.v * (cur.inertia ?? 1.2) + 0.02;
    scores.sort((x, y) => y.v - x.v);
    this.scores = scores;
    const best = scores[0];
    if (!best) return;
    if (cur && cur.lock?.(agent) && !(best.a.emergency && best.v > 0.9)) return;
    if (best.a !== cur) this.switchTo(agent, best);
    else this.reason = best.why;
  }

  switchTo(agent, s) {
    const prev = this.current;
    if (prev) prev.end?.(agent, s.a);
    this.current = s.a;
    this.since = 0;
    this.reason = s.why;
    this.history.unshift({ t: agent.eco.time, id: s.a.id, why: s.why });
    if (this.history.length > 12) this.history.pop();
    s.a.start?.(agent, prev);
  }

  tick(agent, dt) {
    this.since += dt;
    const a = this.current;
    if (!a) return;
    const r = a.tick?.(agent, dt) ?? 'run';
    if (r !== 'run') {
      a.end?.(agent, null);
      this.current = null;
      this.history.unshift({ t: agent.eco.time, id: a.id, why: r === 'done' ? 'tamamlandı' : 'başarısız', end: true });
      if (this.history.length > 12) this.history.pop();
      this.decide(agent);
    }
  }
}
