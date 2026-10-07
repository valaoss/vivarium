import * as THREE from 'three';
import { HALF_W, HALF_D } from '../config.js';
import { SPECIES } from './species.js';
import { sandHeight } from '../world/substrate.js';
import { patchUnderwater } from '../render/water.js';

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  // Gövde: kavisli, segmentli tüp (yerel +Z ileri)
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector3(0, Math.sin(t * Math.PI) * 0.35 - t * 0.15, 1.1 - t * 2.3));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tubular = 40, radial = 12;
  const body = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const p = body.attributes.position;
  const c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / (radial + 1));
    const t = ring / tubular;
    curve.getPointAt(t, c);
    const v = new THREE.Vector3().fromBufferAttribute(p, i).sub(c);
    // kalınlık profili: kafa-göğüs kalın, kuyruğa doğru ince; segment halkaları
    let r = t < 0.05 ? 0.15 + t * 6 : t < 0.42 ? 0.42 : 0.42 - (t - 0.42) * 0.55;
    r *= 1 + 0.06 * Math.max(0, Math.sin(t * 60));
    v.multiplyScalar(r);
    v.x *= 0.85;
    v.y *= 1.05;
    p.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
  }
  body.computeVertexNormals();
  const mat = patchUnderwater(new THREE.MeshPhysicalMaterial({
    color: 0xd01818, roughness: 0.35, clearcoat: 0.8, sheen: 0.6, sheenColor: new THREE.Color(0xff6040),
    transparent: true, opacity: 0.92,
  }), { key: 'shrimp' });
  const legMat = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0xe84a3a, roughness: 0.5, transparent: true, opacity: 0.8 }), { key: 'shrimpleg' });
  const legGeo = new THREE.CylinderGeometry(0.035, 0.025, 0.7, 4);
  legGeo.translate(0, -0.35, 0);
  const fan = new THREE.ConeGeometry(0.35, 0.6, 6, 1, true);
  fan.rotateX(-Math.PI / 2);
  fan.scale(1.3, 0.25, 1);
  const antCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.3, 0.3, 0.9), new THREE.Vector3(0.6, 0.2, 2.0), new THREE.Vector3(0.9, -0.2, 2.8),
  ]);
  const ant = new THREE.TubeGeometry(antCurve, 16, 0.018, 4);
  const eyeGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x050505, clearcoat: 1, roughness: 0.1 });
  SHARED = { body, mat, legMat, legGeo, fan, ant, eyeGeo, eyeMat, tailZ: -1.2 };
  return SHARED;
}

// Tür rengine göre malzeme (red cherry: kırmızı, amano: yarı saydam gri-noktalı)
const MATS = {};
function materialsFor(color) {
  const key = color ?? 'red';
  if (MATS[key]) return MATS[key];
  if (!color) { MATS[key] = { mat: shared().mat, legMat: shared().legMat }; return MATS[key]; }
  const c = new THREE.Color(color);
  const mat = patchUnderwater(new THREE.MeshPhysicalMaterial({
    color: c, roughness: 0.3, clearcoat: 0.8, transparent: true, opacity: 0.7, sheen: 0.4, sheenColor: new THREE.Color(0xc0d0c8),
  }), { key: 'shrimp-' + key, extra: (sh) => {
    // amano: yanlarda küçük kırmızımsı-kahve noktalar
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      { vec2 q = vWPos.xy * 4.5 + vWPos.z * 3.0; float d = fract(sin(dot(floor(q), vec2(12.9898, 78.233))) * 43758.5453);
        float dot_ = step(0.82, d) * smoothstep(0.45, 0.2, length(fract(q) - 0.5));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.2, 0.15), dot_ * 0.8); }`);
  } });
  const legMat = patchUnderwater(new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, transparent: true, opacity: 0.6 }), { key: 'shrimpleg-' + key });
  MATS[key] = { mat, legMat };
  return MATS[key];
}

export const SHRIMP_LABEL = { walk: 'Yürüyor', pick: 'Yüzey temizliyor', eat: 'Artık yiyor', swim: 'Yüzüyor', hide: 'Saklanıyor', sleep: 'Dinleniyor' };

export class Shrimp {
  constructor(data) {
    this.data = data;
    this.sp = SPECIES[data.species] ?? SPECIES.shrimp;
    const s = shared();
    const m = materialsFor(this.sp.color);
    this.group = new THREE.Group();
    const scale = (data.size ?? 1) * (this.sp.size ?? 1);
    this.group.scale.setScalar(scale);
    this.total = 2.6 * scale;
    const body = new THREE.Mesh(s.body, m.mat);
    body.castShadow = true;
    this.group.add(body);
    const tail = new THREE.Mesh(s.fan, m.mat);
    tail.position.set(0, -0.2, -1.4);
    this.group.add(tail);
    this.legs = [];
    for (let i = 0; i < 5; i++) for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(s.legGeo, m.legMat);
      leg.position.set(side * 0.22, -0.2, 0.7 - i * 0.22);
      leg.rotation.z = side * 0.6;
      leg.userData = { side, i };
      this.legs.push(leg);
      this.group.add(leg);
    }
    // yüzme bacakları (karın altında)
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(s.legGeo, m.legMat);
      sw.scale.set(0.8, 0.45, 0.8);
      sw.position.set(side * 0.15, -0.05, -0.15 - i * 0.22);
      sw.userData = { side, i, swim: true };
      this.legs.push(sw);
      this.group.add(sw);
    }
    this.ants = [];
    for (const side of [-1, 1]) {
      const a = new THREE.Mesh(s.ant, m.legMat);
      a.position.set(side * 0.1, 0.15, 1.05);
      a.scale.x = side;
      this.ants.push(a);
      this.group.add(a);
      const e = new THREE.Mesh(s.eyeGeo, s.eyeMat);
      e.position.set(side * 0.2, 0.18, 0.95);
      this.group.add(e);
    }
    const p = data.pos ?? [(Math.random() - 0.5) * 40, 0, (Math.random() - 0.5) * 20];
    this.pos = new THREE.Vector3(p[0], 0, p[2]);
    this.pos.y = sandHeight(this.pos.x, this.pos.z) + 0.55;
    this.heading = Math.random() * Math.PI * 2;
    this.target = new THREE.Vector3();
    this.timer = 0;
    this.state = 'pick';
    this.t = Math.random() * 10;
    this.hop = 0;
    this.u = { uHighlight: { value: 0 } };
  }

  get species() { return this.data.species; }
  get radius() { return this.total * 0.6; }

  update(dt, world) {
    this.t += dt;
    this.timer -= dt;
    const d = this.data;
    if (this.flee > 0) { this.flee -= dt; this.state = 'swim'; }
    else if (this.timer < 0) {
      this.timer = 2 + Math.random() * 5;
      if (world.night > 0.6) this.state = 'sleep';
      else {
        const food = this.findFood(world);
        if (food && d.hunger > 15) { this.state = 'eat'; this.food = food; this.target.copy(food.pos); }
        else {
          this.state = Math.random() < 0.55 ? 'pick' : 'walk';
          if (Math.random() < 0.05) { this.state = 'swim'; this.hop = 1.5; }
          this.target.set(
            THREE.MathUtils.clamp(this.pos.x + (Math.random() - 0.5) * 16, -HALF_W + 2, HALF_W - 2), 0,
            THREE.MathUtils.clamp(this.pos.z + (Math.random() - 0.5) * 10, -HALF_D + 2, HALF_D - 2),
          );
        }
      }
    }
    let speed = 0;
    if (this.state === 'walk' || this.state === 'eat' || this.state === 'swim') {
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
      const L = Math.hypot(dx, dz);
      if (L > 0.5) {
        let want = Math.atan2(dx, dz);
        let dh = want - this.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        this.heading += THREE.MathUtils.clamp(dh, -2.5 * dt, 2.5 * dt);
        speed = this.state === 'swim' ? this.sp.burst * 0.6 : this.sp.cruise * (this.state === 'eat' ? 1.6 : 1);
      } else if (this.state === 'eat' && this.food && !this.food.eaten) {
        this.food.eaten = true;
        d.hunger = Math.max(0, d.hunger - 15);
        world.events.push({ type: 'eat', fish: this, food: this.food });
        this.state = 'pick';
      } else if (this.state !== 'pick') this.state = 'pick';
    }
    if (this.flee > 0) { this.heading = Math.atan2(this.fleeDir.x, this.fleeDir.z); speed = this.sp.burst; }
    this.pos.x += Math.sin(this.heading) * speed * dt;
    this.pos.z += Math.cos(this.heading) * speed * dt;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -HALF_W + 1.5, HALF_W - 1.5);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -HALF_D + 1.5, HALF_D - 1.5);
    // taşlardan kaç
    for (const ob of world.obstacles) {
      const dx = this.pos.x - ob.pos.x, dz = this.pos.z - ob.pos.z;
      const L = Math.hypot(dx, dz);
      if (ob.top && L < ob.r * 0.8 && L > 1e-3) { this.pos.x += dx / L * dt * 3; this.pos.z += dz / L * dt * 3; }
    }
    this.hop = Math.max(0, this.hop - dt);
    const ground = sandHeight(this.pos.x, this.pos.z) + 0.55;
    const swimY = this.state === 'swim' ? Math.sin(Math.min(this.hop, 1.5) / 1.5 * Math.PI) * 4 : 0;
    this.pos.y = THREE.MathUtils.lerp(this.pos.y, ground + swimY, 0.15);

    // eğim: zemine uyum
    const ahead = sandHeight(this.pos.x + Math.sin(this.heading), this.pos.z + Math.cos(this.heading));
    const pitch = -Math.atan2(ahead - (ground - 0.55), 1) * 0.8;
    this.group.position.copy(this.pos);
    this.group.rotation.set(pitch, this.heading, 0, 'YXZ');

    // bacak ve anten animasyonu
    const walking = speed > 0.1;
    for (const leg of this.legs) {
      const { side, i, swim } = leg.userData;
      if (swim) leg.rotation.x = Math.sin(this.t * (this.state === 'swim' ? 22 : 6) + i * 0.9) * (this.state === 'swim' ? 0.7 : 0.25) + 0.3;
      else {
        const ph = this.t * (walking ? 12 : this.state === 'pick' ? 7 : 1) + i * 1.3 + (side > 0 ? Math.PI : 0);
        leg.rotation.x = Math.sin(ph) * (walking ? 0.5 : this.state === 'pick' && i < 1 ? 0.8 : 0.05);
        if (i === 0 && this.state === 'pick') leg.rotation.z = side * (0.3 + Math.abs(Math.sin(ph)) * 0.6);
      }
    }
    this.ants.forEach((a, k) => { a.rotation.y = Math.sin(this.t * 1.3 + k * 2) * 0.25; a.rotation.x = Math.sin(this.t * 0.9 + k) * 0.15; });
  }

  findFood(world) {
    let best = null, bd = 25;
    for (const f of world.food) {
      if (f.eaten || f.state !== 'settled') continue;
      const dd = f.pos.distanceTo(this.pos);
      if (dd < bd) { bd = dd; best = f; }
    }
    return best;
  }

  scare(from) {
    if (this.pos.distanceTo(from) > 20) return;
    this.flee = 0.5;
    this.fleeDir = new THREE.Vector3().subVectors(this.pos, from).setY(0).normalize();
    this.hop = 1;
    this.data.stress = Math.min(100, this.data.stress + 4);
  }

  serialize() {
    this.data.pos = [this.pos.x, this.pos.y, this.pos.z].map((v) => Math.round(v * 10) / 10);
    return this.data;
  }
  dispose() {}
}

