import * as THREE from 'three';

// Ortak ayak yerleştirme: her bacağın gövdeye göre bir "ev" noktası ve yürüyüş döngüsünde bir faz kayması var.
// Basma (stance) evresinde ayak dünyada kilitlidir, kaymaz. Salınımda (swing) kalkış noktasından, gövdenin hızı ve
// dönüşü hesaba katılarak tahmin edilen iniş noktasına alçak bir yayla gider; yol üstündeki en yüksek zemini aşar.
// Dururken bacaklar yerinde kalır; ev noktasından fazla uzaklaşan ayak tek tek düzeltme adımı atar.

const _h = new THREE.Vector3(), _p = new THREE.Vector3();

export class FootPlanter {
  // legs: [{ home: Vector3 (gövde yereli, x yan, z ileri), offset: 0..1 faz kayması }]
  // opts: duty (basma oranı), lift (cm), stride (cm, ölçek 1), quick (düzeltme adımı s), reset (ev uzaklığı eşiği, cm)
  constructor(legs, opts = {}) {
    this.duty = opts.duty ?? 0.7;
    this.lift = opts.lift ?? 0.2;
    this.stride = opts.stride ?? 1;
    this.quick = opts.quick ?? 0.18;
    this.reset = opts.reset ?? 0.5;
    // valid(x, z, y): bacak bu noktaya basabilir mi (yükseklik, diklik); değilse gövdeye doğru en yakın uygun nokta aranır
    this.valid = opts.valid ?? null;
    this.phase = 0;
    this.feet = legs.map((l) => ({
      home: l.home.clone(), offset: l.offset, pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(),
      planted: false, swing: -1, swingT: 0, swingDur: 0, contact: 0, init: false,
    }));
  }

  // body: { pos, heading, scale }; vel: dünya hızı (cm/s); yawRate (rad/s); ground(x,z)
  update(dt, body, vel, yawRate, ground) {
    const speed = Math.hypot(vel.x, vel.z);
    const moving = speed > 0.05 * body.scale || Math.abs(yawRate) > 0.15;
    const stride = this.stride * body.scale;
    // adım sıklığı hızla artar; dönerken de yerinde adım atılır
    const freq = moving ? Math.min(6, Math.max(0.6, speed / stride + Math.abs(yawRate) * 0.6)) : 0;
    this.phase = (this.phase + freq * dt) % 1;
    const T = freq > 0 ? 1 / freq : 1;
    const swingDur = (1 - this.duty) * T;
    let quickBusy = this.feet.some((f) => f.swing === 2);

    for (const f of this.feet) {
      this.homeWorld(f.home, body, _h);
      this.land(_h, body, ground);
      if (!f.init) { f.pos.copy(_h); f.planted = true; f.init = true; continue; }
      const ph = (this.phase + f.offset) % 1;
      const inSwing = moving && ph >= this.duty;
      if (f.swing === -1 && inSwing && f.planted) this.startSwing(f, Math.max(0.05, swingDur * (1 - (ph - this.duty) / (1 - this.duty))), 1);
      // düzeltme adımı: ayak evinden çok uzak (itildi, döndü, durdu)
      const far = Math.hypot(f.pos.x - _h.x, f.pos.z - _h.z) > this.reset * body.scale * (moving ? 1.3 : 0.6);
      if (f.swing === -1 && far && !quickBusy && (!moving || ph < this.duty)) { this.startSwing(f, this.quick, 2); quickBusy = true; }

      if (f.swing !== -1) {
        f.swingT += dt;
        const s = Math.min(1, f.swingT / f.swingDur);
        // iniş noktasını sürekli güncelle: gövde ilerledikçe hedef de ilerler
        const lead = f.swing === 1 ? (f.swingDur - f.swingT) + this.duty * T * 0.5 : 0;
        this.predict(f.home, body, vel, yawRate, lead, _p);
        this.land(_p, body, ground);
        f.to.copy(_p);
        const e = s * s * (3 - 2 * s);
        f.pos.lerpVectors(f.from, f.to, e);
        let top = Math.max(f.from.y, f.to.y);
        for (let k = 1; k < 4; k++) {
          const t = k / 4;
          top = Math.max(top, ground(f.from.x + (f.to.x - f.from.x) * t, f.from.z + (f.to.z - f.from.z) * t));
        }
        const base = f.from.y + (f.to.y - f.from.y) * e;
        f.pos.y = base + (Math.max(top - base, 0) + this.lift * body.scale) * Math.sin(Math.PI * s);
        f.planted = false;
        if (s >= 1) { f.pos.copy(f.to); f.swing = -1; f.planted = true; }
      } else {
        // basan ayak kilitli; yalnızca zemin yüksekliği (ör. kum) izlenir
        f.pos.y = ground(f.pos.x, f.pos.z);
      }
      f.contact = f.planted ? 1 : 0;
    }
  }

  land(p, body, ground) {
    p.y = ground(p.x, p.z);
    if (!this.valid || this.valid(p.x, p.z, p.y)) return p;
    const x0 = p.x, z0 = p.z;
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      p.x = x0 + (body.pos.x - x0) * t; p.z = z0 + (body.pos.z - z0) * t;
      p.y = ground(p.x, p.z);
      if (this.valid(p.x, p.z, p.y)) return p;
    }
    return p;
  }

  startSwing(f, dur, kind) {
    f.from.copy(f.pos);
    f.swing = kind;
    f.swingT = 0;
    f.swingDur = dur;
  }

  homeWorld(home, body, out) {
    const c = Math.cos(body.heading), s = Math.sin(body.heading), k = body.scale;
    return out.set(body.pos.x + (home.x * c + home.z * s) * k, body.pos.y, body.pos.z + (-home.x * s + home.z * c) * k);
  }

  // t saniye sonra ev noktasının dünyadaki tahmini yeri
  predict(home, body, vel, yawRate, t, out) {
    const hd = body.heading + yawRate * t;
    const c = Math.cos(hd), s = Math.sin(hd), k = body.scale;
    return out.set(body.pos.x + vel.x * t + (home.x * c + home.z * s) * k, 0, body.pos.z + vel.z * t + (-home.x * s + home.z * c) * k);
  }

  // dışarıdan düzeltme adımı (ör. bacak menzil dışında kaldı)
  step(f) {
    if (f.swing !== -1 || this.feet.some((o) => o.swing === 2)) return;
    this.startSwing(f, this.quick, 2);
  }

  // yüzmeye / kaçışa geçince bacaklar zeminden kopar
  release() { for (const f of this.feet) { f.init = false; f.swing = -1; f.planted = false; f.contact = 0; } }
}
