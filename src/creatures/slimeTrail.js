import * as THREE from 'three';
import { patchUnderwater } from '../render/water.js';

// Salyangoz mukus izi: tabanın bıraktığı ince, parlak şerit. Zamanla incelip kaybolur.
// Noktalar dünya uzayında; her nokta yüzey normali ve yan vektörüyle iki köşe üretir.
export class SlimeTrail {
  constructor(scene, { max = 260, width = 0.7, life = 240 } = {}) {
    this.max = max; this.width = width; this.life = life;
    this.pts = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 2 * 3);
    this.age = new Float32Array(max * 2);
    this.side = new Float32Array(max * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(this.age, 1));
    geo.setAttribute('aS', new THREE.BufferAttribute(this.side, 1));
    const idx = [];
    for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.u = { uNow: { value: 0 }, uLife: { value: life } };
    const mat = patchUnderwater(new THREE.MeshPhysicalMaterial({
      color: 0xdfe8e0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
    }), {
      key: 'slime-trail',
      uniforms: this.u,
      extra: (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aT; attribute float aS; varying float vA; varying float vS; uniform float uNow; uniform float uLife;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvA = clamp(1.0 - (uNow - aT) / uLife, 0.0, 1.0); vS = aS;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vA; varying float vS;')
          .replace('#include <color_fragment>', `#include <color_fragment>
            // kenarlar ince, orta kalın; yaşlandıkça hem incelir hem saydamlaşır
            float edge = 1.0 - smoothstep(vA * 0.8, vA * 0.8 + 0.2, abs(vS));
            diffuseColor.a *= edge * vA;`);
      },
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  // p: taban ortası (dünya), n: yüzey normali, side: yana birim vektör
  add(p, n, side, now, w) {
    const last = this.pts[this.pts.length - 1];
    if (last && last.p.distanceTo(p) < 0.15) return;
    this.pts.push({ p: p.clone().addScaledVector(n, 0.02), side: side.clone(), w: w ?? this.width, t: now });
    if (this.pts.length > this.max) this.pts.shift();
    this.rebuild();
  }

  // kopukluk: salyangoz kabuğuna çekildi, yüzey değişti → yeni şerit başlat (araya görünmez nokta)
  cut() { const l = this.pts[this.pts.length - 1]; if (l) l.cut = true; }

  rebuild() {
    const n = this.pts.length;
    for (let i = 0; i < n; i++) {
      const q = this.pts[i], h = q.w / 2;
      const hide = q.cut || (i > 0 && this.pts[i - 1].cut) ? 0 : 1;
      this.pos.set([q.p.x + q.side.x * h, q.p.y + q.side.y * h, q.p.z + q.side.z * h, q.p.x - q.side.x * h, q.p.y - q.side.y * h, q.p.z - q.side.z * h], i * 6);
      this.age[i * 2] = this.age[i * 2 + 1] = hide ? q.t : -1e6;
      this.side[i * 2] = 1; this.side[i * 2 + 1] = -1;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aT.needsUpdate = true;
    g.attributes.aS.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, n - 1) * 6);
  }

  update(now) {
    this.u.uNow.value = now;
    while (this.pts.length && now - this.pts[0].t > this.life) this.pts.shift();
  }

  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
