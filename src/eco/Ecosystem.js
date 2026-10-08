import * as THREE from 'three';

// Ortak ekosistem çekirdeği. Her canlı (ajan) burada kayıtlıdır; canlılar birbirini doğrudan değil,
// buradaki sorgular ve uyaranlar üzerinden (görüntü, titreşim, kimyasal iz, temas) algılar.
// Yakındaki / görünen ajanlar sık düşünür ve tam animasyonla güncellenir; uzaktakiler seyrek.

const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();

export class Ecosystem {
  constructor(world) {
    this.world = world;
    this.entities = [];
    this.cell = 6;
    this.grid = new Map();
    this.vib = [];            // kısa ömürlü titreşim olayları
    this.cues = [];           // kimyasal izler (ipek üstündeki feromonlar vb.)
    this.time = 0;
    this.nextId = 1;
    this.listeners = {};
    this.stats = { thinks: 0, agents: 0, visible: 0 };
  }

  on(ev, fn) { (this.listeners[ev] ??= []).push(fn); }
  emit(ev, d) { for (const fn of this.listeners[ev] ?? []) fn(d); }

  add(e) {
    e.id ??= this.nextId++;
    e.alive ??= true;
    this.entities.push(e);
    this.emit('add', e);
    return e;
  }
  remove(e) {
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
    e.alive = false;
    this.emit('remove', e);
  }
  byId(id) { return this.entities.find((e) => e.id === id); }

  key(x, z) { return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`; }
  rebuild() {
    this.grid.clear();
    for (const e of this.entities) {
      if (!e.alive) continue;
      const k = this.key(e.pos.x, e.pos.z);
      let c = this.grid.get(k);
      if (!c) this.grid.set(k, (c = []));
      c.push(e);
    }
  }
  // yarıçap içindeki varlıklar (3B uzaklık)
  query(p, r, filter, out = []) {
    out.length = 0;
    const c0x = Math.floor((p.x - r) / this.cell), c1x = Math.floor((p.x + r) / this.cell);
    const c0z = Math.floor((p.z - r) / this.cell), c1z = Math.floor((p.z + r) / this.cell);
    for (let i = c0x; i <= c1x; i++) for (let j = c0z; j <= c1z; j++) {
      const c = this.grid.get(`${i},${j}`);
      if (!c) continue;
      for (const e of c) if (e.alive && e.pos.distanceTo(p) <= r && (!filter || filter(e))) out.push(e);
    }
    return out;
  }

  // Titreşim olayı: medium 'water' | 'ground' | 'plant' | 'silk'
  // amp: kaynakta genlik (0-1+), irregular: düzensizlik (çırpınan böcek ~1, tek damla ~0), dur: süre (s)
  vibrate(src, pos, medium, amp, irregular = 0.5, dur = 0.2) {
    this.vib.push({ src, pos: pos.clone(), medium, amp, irregular, dur, t: this.time });
  }

  cue(kind, pos, data, life) { this.cues.push({ kind, pos: pos.clone(), data, t: this.time, life }); }

  update(dt, camera) {
    this.time += dt;
    // eski uyaranları at
    let n = 0;
    for (const v of this.vib) if (this.time - v.t < 1.2) this.vib[n++] = v;
    this.vib.length = n;
    n = 0;
    for (const c of this.cues) if (this.time - c.t < c.life) this.cues[n++] = c;
    this.cues.length = n;
    this.rebuild();

    if (camera) { _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frustum.setFromProjectionMatrix(_pm); }
    let thinks = 0, vis = 0, ag = 0;
    for (const e of this.entities.slice()) {
      if (!e.alive || !e.isAgent) continue;
      ag++;
      // ayrıntı düzeyi: görünür ve yakın → her kare tam; görünmez → seyrek düşünme, basit hareket
      _sph.set(e.pos, (e.radius ?? 3) + 2);
      const visible = !camera || _frustum.intersectsSphere(_sph);
      const dist = camera ? camera.position.distanceTo(e.pos) : 50;
      e.lod = visible ? (dist < 160 ? 0 : 1) : 2;
      if (visible) vis++;
      const interval = e.thinkInterval * (e.lod === 0 ? 1 : e.lod === 1 ? 2 : 4);
      e.thinkAcc = (e.thinkAcc ?? Math.random() * interval) + dt;
      if (e.thinkAcc >= interval) { e.think(e.thinkAcc); e.thinkAcc = 0; thinks++; }
      e.update(dt, e.lod);
    }
    this.stats.thinks = thinks; this.stats.agents = ag; this.stats.visible = vis;
  }
}
