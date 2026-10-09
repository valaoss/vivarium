// Change only render resolution under sustained load. Geometry, animal behaviour,
// shadows and water simulation keep their original quality. Hysteresis prevents
// visible resolution pumping during brief shader compilation or pointer bursts.
export class FrameBudget {
  constructor(maxRatio, minRatio = Math.min(0.75, maxRatio)) {
    this.maxRatio = maxRatio;
    this.minRatio = minRatio;
    this.ratio = maxRatio;
    this.elapsed = 0;
    this.frames = 0;
    this.fastWindows = 0;
    // geri yükseltme kısa süre sonra yine düşürmeye yol açarsa (sınırda kalan cihaz) bir sonraki
    // deneme giderek uzayan bir beklemeden sonra yapılır: çözünürlük gidip gelmez, takılma olmaz
    this.sinceRaise = Infinity;
    this.failedRaises = 0;
  }

  sample(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.15) return null;
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed < 3) return null;
    const average = this.elapsed / this.frames;
    this.elapsed = this.frames = 0;
    let next = this.ratio;
    this.sinceRaise++;
    if (average > 1 / 42) {
      // en düşük çözünürlükte de yavaşsa çağıran kaliteyi düşürür
      if (this.ratio <= this.minRatio) { this.fastWindows = 0; return 'degrade'; }
      // az önceki yükseltme kaldırılamadıysa yalnız onu geri al
      const failed = this.sinceRaise <= 3;
      next = Math.max(this.minRatio, this.ratio - (failed ? 0.1 : 0.2));
      this.fastWindows = 0;
      if (failed && next !== this.ratio) this.failedRaises = Math.min(5, this.failedRaises + 1);
    } else if (average < 1 / 57) {
      if (++this.fastWindows >= 3 * 3 ** this.failedRaises) {
        this.sinceRaise = 0;
        next = Math.min(this.maxRatio, this.ratio + 0.1);
        this.fastWindows = 0;
      }
    } else this.fastWindows = 0;
    next = Math.round(next * 100) / 100;
    if (next === this.ratio) return null;
    this.ratio = next;
    return next;
  }
}

export function trackFrameBudget(world) {
  const budget = new FrameBudget(world.renderer.getPixelRatio());
  return (dt) => {
    if (document.hidden || world.photo) return;
    const ratio = budget.sample(dt);
    if (ratio === null) return;
    if (ratio === 'degrade') { world.degradeQuality?.(); return; }
    world.renderer.setPixelRatio(ratio);
    world.fx.composer.setPixelRatio(ratio);
    world.reflection.setSize(window.innerWidth, window.innerHeight);
    for (const mirror of world.mirrors ?? []) mirror.setSize(window.innerWidth, window.innerHeight);
  };
}
