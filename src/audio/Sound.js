import { TANK, HALF_W, HALF_D } from '../config.js';

/*
 * Tamamen sentezlenmiş ses: harici dosya yok.
 * Ortam katmanları (filtre uğultusu, su şırıltısı, hava taşı kabarcıkları, oda)
 * sürekli çalar; olaylar (cama vurma, yem, su değişimi...) tek seferlik çalınır.
 * Kamera suyun içine girince her şey alçak geçiren filtreyle boğuklaşır.
 */
const MUTE_KEY = 'vivarium.muted';

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* yok say */ }
    this.bubbleAcc = 0;
    this.wipeLevel = 0;
    this.lastEat = 0;
  }

  /** Tarayıcılar sesi ancak kullanıcı etkileşiminden sonra başlatır. */
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18000;
    this.muffle.Q.value = 0.5;
    this.muffle.connect(comp).connect(this.master).connect(ctx.destination);

    // Ortam ve olaylar ayrı kanallarda; ortam kameranın uzaklığına göre kısılır
    this.ambient = ctx.createGain();
    this.ambient.gain.value = 0;
    this.ambient.connect(this.muffle);
    this.fx = ctx.createGain();
    this.fx.gain.value = 1;
    this.fx.connect(this.muffle);

    this.noise = this.makeNoise(3, 'white');
    this.brown = this.makeNoise(4, 'brown');

    this.buildAmbience();
  }

  makeNoise(seconds, kind) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  loopNoise(buf) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = Math.random();
    src.start(0, Math.random() * buf.duration);
    return src;
  }

  buildAmbience() {
    const ctx = this.ctx;

    // Filtre motoru: alçak uğultu + hafif 100 Hz titreşim
    const hum = this.loopNoise(this.brown);
    const humBp = ctx.createBiquadFilter();
    humBp.type = 'bandpass'; humBp.frequency.value = 140; humBp.Q.value = 0.9;
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0.22;
    hum.connect(humBp).connect(this.humGain).connect(this.ambient);
    const motor = ctx.createOscillator();
    motor.frequency.value = 100;
    const motorGain = ctx.createGain(); motorGain.gain.value = 0.006;
    motor.connect(motorGain).connect(this.ambient);
    motor.start();

    // Filtre çıkışından yüzeye dökülen su: dalgalanan bant geçiren gürültü
    const trickle = this.loopNoise(this.noise);
    this.trickleBp = ctx.createBiquadFilter();
    this.trickleBp.type = 'bandpass'; this.trickleBp.frequency.value = 1500; this.trickleBp.Q.value = 0.7;
    this.trickleGain = ctx.createGain(); this.trickleGain.gain.value = 0.02;
    trickle.connect(this.trickleBp).connect(this.trickleGain).connect(this.ambient);

    // Oda: çok hafif kahverengi gürültü (sessizlik bile "dolu" olsun)
    const room = this.loopNoise(this.brown);
    const roomLp = ctx.createBiquadFilter();
    roomLp.type = 'lowpass'; roomLp.frequency.value = 300;
    const roomGain = ctx.createGain(); roomGain.gain.value = 0.05;
    room.connect(roomLp).connect(roomGain).connect(this.master);

    // Kabarcıklar ayrı bir kanalda (hava taşı kapanınca susar)
    this.bubbleBus = ctx.createGain();
    this.bubbleBus.gain.value = 1;
    this.bubbleBus.connect(this.ambient);
  }

  // ------------------------------------------------------------ yardımcılar
  env(gainNode, t, attack, peak, decay) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  tone(freq, t, { type = 'sine', attack = 0.005, peak = 0.1, decay = 0.2, endFreq = null, dest = this.fx } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + attack + decay);
    const g = ctx.createGain();
    this.env(g, t, attack, peak, decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  burst(t, { freq = 1000, q = 1, type = 'bandpass', attack = 0.002, peak = 0.1, decay = 0.1, buf = this.noise, dest = this.fx, rate = 1 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, attack, peak, decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * (buf.duration - 0.5));
    src.stop(t + attack + decay + 0.05);
    return { src, f, g };
  }

  // Tek kabarcık: frekansı hızla yükselen kısa sinüs (Minnaert rezonansı)
  bubble(t, size = Math.random(), gain = 1, dest = this.bubbleBus) {
    const f0 = 450 + (1 - size) * 1700;
    this.tone(f0, t, { attack: 0.003, peak: 0.045 * gain * (0.4 + size), decay: 0.03 + size * 0.06, endFreq: f0 * (1.6 + Math.random() * 0.8), dest });
  }

  // ------------------------------------------------------------ olaylar
  play(name, opts = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + 0.01;
    switch (name) {
      case 'tap': {
        const s = Math.min(1.6, opts.strength ?? 1);
        // tok vuruş + camın kısa çınlaması
        this.tone(170, t, { attack: 0.002, peak: 0.35 * s, decay: 0.16, endFreq: 110 });
        this.burst(t, { freq: 600, type: 'lowpass', peak: 0.25 * s, decay: 0.05 });
        this.tone(2350, t, { attack: 0.001, peak: 0.03 * s, decay: 0.35 });
        this.tone(3710, t, { attack: 0.001, peak: 0.018 * s, decay: 0.25 });
        // birkaç kabarcık (ürken balıklar)
        for (let i = 0; i < 3; i++) this.bubble(t + 0.05 + Math.random() * 0.25, Math.random(), 0.6, this.fx);
        break;
      }
      case 'feed': {
        // kapaktan dökülen pullar: ince tıkırtılar + yüzeye küçük şıpırtılar
        for (let i = 0; i < 9; i++) {
          const tt = t + Math.random() * 0.35;
          this.burst(tt, { freq: 4000 + Math.random() * 3000, q: 4, peak: 0.05, decay: 0.012 });
          if (Math.random() < 0.5) this.bubble(tt + 0.02, 0.2 + Math.random() * 0.3, 0.5, this.fx);
        }
        break;
      }
      case 'eat': {
        const now = this.ctx.currentTime;
        if (now - this.lastEat < 0.08) return;
        this.lastEat = now;
        // küçük "şap": ağzın yüzeyde açılıp kapanması
        this.burst(t, { freq: 900 + Math.random() * 600, q: 3, peak: 0.06, decay: 0.03 });
        this.bubble(t + 0.01, 0.6, 0.5, this.fx);
        break;
      }
      case 'waterChange': {
        const dur = 1.2 + (opts.frac ?? 0.25) * 5;
        // hortumla çekme (alçak emiş) → temiz su dökme (geniş şırıltı)
        const suck = this.burst(t, { freq: 350, q: 0.8, attack: 0.3, peak: 0.12, decay: dur * 0.5, buf: this.brown });
        suck.f.frequency.linearRampToValueAtTime(220, t + dur * 0.5);
        const pour = this.burst(t + dur * 0.45, { freq: 1200, q: 0.5, attack: 0.4, peak: 0.16, decay: dur * 0.6 });
        pour.f.frequency.linearRampToValueAtTime(2200, t + dur);
        for (let i = 0; i < 40; i++) this.bubble(t + dur * 0.45 + Math.random() * dur * 0.6, Math.random(), 0.8, this.fx);
        break;
      }
      case 'plant': {
        // kuma bastırma: kumlu hışırtı
        for (let i = 0; i < 4; i++) this.burst(t + i * 0.05, { freq: 2500, q: 0.6, peak: 0.06, decay: 0.06, buf: this.noise });
        this.burst(t, { freq: 300, type: 'lowpass', peak: 0.12, decay: 0.12, buf: this.brown });
        break;
      }
      case 'shutter': {
        this.burst(t, { freq: 5000, type: 'highpass', peak: 0.2, decay: 0.02 });
        this.burst(t + 0.07, { freq: 3000, q: 2, peak: 0.12, decay: 0.03 });
        this.tone(140, t, { attack: 0.001, peak: 0.08, decay: 0.05 });
        break;
      }
      case 'click':
        this.tone(1100, t, { attack: 0.002, peak: 0.025, decay: 0.04, endFreq: 900 });
        break;
      case 'chime': {
        // görev: iki yumuşak çan sesi
        [1046.5, 1568].forEach((f, i) => {
          this.tone(f, t + i * 0.12, { attack: 0.005, peak: 0.07, decay: 1.2 });
          this.tone(f * 2.01, t + i * 0.12, { attack: 0.005, peak: 0.015, decay: 0.6 });
        });
        break;
      }
      case 'discover': {
        [784, 988, 1318.5].forEach((f, i) => this.tone(f, t + i * 0.1, { attack: 0.01, peak: 0.05, decay: 1.4 }));
        break;
      }
      case 'warn':
        this.tone(520, t, { attack: 0.01, peak: 0.04, decay: 0.25 });
        this.tone(440, t + 0.14, { attack: 0.01, peak: 0.04, decay: 0.3 });
        break;
      default:
    }
  }

  // ------------------------------------------------------------ her kare
  update(dt, { camera, airstone, lightLevel, speed, wiping }) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const p = camera.position;

    // Kamera suyun içinde mi? (ses boğuklaşır, ortam yükselir)
    const inside = Math.abs(p.x) < HALF_W && Math.abs(p.z) < HALF_D && p.y > 0 && p.y < TANK.water;
    this.muffle.frequency.setTargetAtTime(inside ? 650 : 18000, t, 0.15);

    // Uzaklık: tanka yaklaştıkça ortam sesi artar
    const dist = Math.hypot(p.x, p.y - TANK.water / 2, p.z);
    const near = inside ? 1.3 : Math.min(1, 70 / Math.max(dist, 30));
    this.ambient.gain.setTargetAtTime(0.9 * near, t, 0.3);

    // Su şırıltısı doğal dalgalansın
    this.trickleBp.frequency.setTargetAtTime(1300 + Math.random() * 700, t, 0.2);
    this.trickleGain.gain.setTargetAtTime(0.012 + Math.random() * 0.016, t, 0.15);

    // Hava taşı: saniyede ~20 kabarcık, hızlandırılmış zamanda biraz daha sık
    this.bubbleBus.gain.setTargetAtTime(airstone ? 1 : 0, t, 0.4);
    if (airstone && !this.muted) {
      this.bubbleAcc += dt * (18 + Math.min(speed, 4) * 2) * (0.7 + Math.random() * 0.6);
      let k = 0;
      while (this.bubbleAcc > 1 && k++ < 6) {
        this.bubbleAcc -= 1;
        this.bubble(t + Math.random() * 0.05, Math.random() ** 1.5, 0.9);
      }
      // yüzeyde patlayan büyük kabarcıklar
      if (Math.random() < dt * 4) this.burst(t, { freq: 1800 + Math.random() * 1500, q: 2, peak: 0.02, decay: 0.03, dest: this.bubbleBus });
    }

    // Gece: filtre uğultusu duyulur hale gelir (oda sessizleşir)
    this.humGain.gain.setTargetAtTime(0.18 + (1 - lightLevel) * 0.08, t, 1);

    // Cam silerken gıcırtı
    this.wipeLevel += ((wiping ? 1 : 0) - this.wipeLevel) * Math.min(1, dt * 12);
    if (this.wipeLevel > 0.05 && !this.muted) {
      if (!this.squeak) {
        const src = this.loopNoise(this.noise);
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass'; f.Q.value = 8; f.frequency.value = 2400;
        const g = this.ctx.createGain(); g.gain.value = 0;
        src.connect(f).connect(g).connect(this.fx);
        this.squeak = { src, f, g };
      }
      this.squeak.f.frequency.setTargetAtTime(1900 + Math.random() * 1400, t, 0.03);
      this.squeak.g.gain.setTargetAtTime(this.wipeLevel * (0.05 + Math.random() * 0.06), t, 0.03);
    } else if (this.squeak) {
      this.squeak.g.gain.setTargetAtTime(0, t, 0.05);
    }
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* yok say */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.1);
  }
}
