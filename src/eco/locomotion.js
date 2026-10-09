// Hayvan hareketinin ortak yapı taşları: kuvvetle yüzme (itki + su direnci), kuyruk vuruşu / süzülme
// döngüsü, eylemsizlikli dönüş ve doğal rastgelelik (yavaş kayan gürültü, ağır kuyruklu süreler).

// Ornstein-Uhlenbeck gürültüsü: ortalamaya geri dönen, yumuşak ve tahmin edilemez kayma (titreşim değil)
export class Drift {
  constructor(rand, tau = 3, sigma = 1) { this.rand = rand; this.tau = tau; this.sigma = sigma; this.v = 0; }
  step(dt) {
    const g = (this.rand() + this.rand() + this.rand() - 1.5) * 2;      // ~N(0,1)
    this.v += -this.v * dt / this.tau + this.sigma * Math.sqrt(2 * dt / this.tau) * g;
    return this.v;
  }
}

// Ağır kuyruklu süre (Pareto): çoğu kısa, arada bir çok uzun (gerçek duraklama ve gezinti dağılımı)
export function heavyTail(rand, min, max, alpha = 1.6) {
  return Math.min(max, min / Math.pow(1 - rand() * 0.999, 1 / alpha));
}

/*
 * İtki ile yüzme. Hız seçilmez: kuyruk vuruşu itki üretir, su direnci (doğrusal + karesel) yavaşlatır.
 * gait 'burst': 1–3 sert vuruş + uzun süzülme; 'steady': sürekli ve hıza göre ayarlanan vuruş;
 * 'hover': yavaş, yüzgeçlerle yerinde durabilen. Terminal hız = burst (tam itki).
 */
export class SwimDrive {
  constructor({ cruise, burst, gait = 'steady', rand = Math.random, glideTau = 0.9 }) {
    this.gait = gait;
    this.rand = rand;
    this.burst = burst;
    this.cruise = cruise;
    this.lin = 1 / glideTau;                                   // süzülmede hız ~glideTau sn'de e'ye iner
    this.quad = 0.6 / Math.max(1, burst);
    this.maxThrust = this.lin * burst + this.quad * burst * burst;
    this.u = 0;            // ileri hız
    this.beats = 0;        // kalan sert vuruş
    this.beatT = 0;
    this.thrust = 0;       // 0..1 (animasyon ve yüzgeçler için)
    this.gliding = true;
  }

  drag(u) { return this.lin * u + this.quad * u * Math.abs(u); }

  // want: istenen ortalama hız; urgent: kaçış / atak (sürekli tam itki); kick: dönüşle başlayan vuruş
  step(dt, want, { urgent = false, kick = false, turnLoss = 0 } = {}) {
    let F = 0;
    if (urgent) {
      F = this.maxThrust; this.beats = 0; this.gliding = false;
    } else if (this.gait === 'burst' && want > 0.05) {
      // süzülürken hız istenenin altına düşünce (ya da dönüşte) kısa bir vuruş dizisi
      if (this.beats <= 0 && (this.u < want * 0.6 || kick)) {
        const gap = Math.max(0, want - this.u) / Math.max(this.burst, 1e-3);
        this.beats = 1 + Math.floor(this.rand() * (gap > 0.25 ? 3 : 2));
        this.beatT = 0;
      }
      if (this.beats > 0) {
        this.beatT += dt;
        const beatDur = 0.09 + 0.06 * (1 - Math.min(1, want / this.burst));
        if (this.beatT > beatDur) { this.beatT = 0; this.beats--; }
        // vuruş sertliği: ortalama hız want olacak kadar (süzülme payıyla)
        F = Math.min(this.maxThrust, this.drag(Math.min(this.burst, want * 1.9 + 1)) * 1.4);
        this.gliding = false;
      } else this.gliding = true;
    } else {
      // sürekli yüzme: direnci karşıla + farkı kapat
      const err = want - this.u;
      F = Math.max(0, Math.min(this.maxThrust, this.drag(want) + err * (this.gait === 'hover' ? 1.5 : 3)));
      this.gliding = F < this.drag(want) * 0.3;
      this.beats = 0;
    }
    this.u += (F - this.drag(this.u)) * dt;
    this.u -= this.u * turnLoss * dt;                          // keskin dönüş gövdeyi frenler
    if (this.u < 0) this.u = 0;
    const t = F / this.maxThrust;
    this.thrust += (t - this.thrust) * Math.min(1, dt * 18);
    return this.u;
  }
}

// Eylemsizlikli dönüş: açısal hız hedefe ivmeyle yaklaşır (ani sapma yok), en çok maxRate
export function steerRate(err, rate, maxRate, accel, dt) {
  const target = Math.sign(err) * Math.min(maxRate, Math.sqrt(2 * accel * Math.abs(err)) * 0.9);
  return rate + Math.max(-accel * dt, Math.min(accel * dt, target - rate));
}
