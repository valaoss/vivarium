import * as THREE from 'three';
import { HALF_W, HALF_D } from '../config.js';
import { containGroup } from './contain.js';
import { SPECIES } from './species.js';
import { sandHeight } from '../world/substrate.js';
import { patchUnderwater } from '../render/water.js';

/*
 * Caridea anatomisi (yerel +Z ileri, +Y sırt): dikenli rostrum, yanlardan
 * basık kabuk (karapaks), birbirine geçen 6 karın halkası ve kuyruk yelpazesi
 * (telson + 4 uropod). 5 çift eklemli yürüme bacağı (ilk ikisi tüylü uçlu,
 * yem toplayan kıskaçlar), karın altında 5 çift yüzme bacağı, sapın ucunda
 * gözler, uzun antenler ve çatallı antenciklerle.
 */

const SEG = [
  { L: 0.24, rx: 0.19, ry: 0.29, rest: 0.1, pl: 1.3 },
  { L: 0.25, rx: 0.185, ry: 0.3, rest: 0.08, pl: 1.35 },
  { L: 0.27, rx: 0.175, ry: 0.28, rest: -0.45, pl: 1.3 },
  { L: 0.22, rx: 0.145, ry: 0.22, rest: -0.25, pl: 1.15 },
  { L: 0.2, rx: 0.115, ry: 0.17, rest: -0.15, pl: 1.1 },
  { L: 0.3, rx: 0.08, ry: 0.12, rest: -0.05, pl: 1.05 },
];
// yürüme bacakları: z konumu, öne açı, uyluk/baldır boyu
const LEGS = [
  { z: 1.0, fwd: 1.0, a: 0.2, b: 0.2, chela: true },
  { z: 0.86, fwd: 0.75, a: 0.22, b: 0.24, chela: true },
  { z: 0.7, fwd: 0.2, a: 0.3, b: 0.36 },
  { z: 0.54, fwd: -0.15, a: 0.31, b: 0.37 },
  { z: 0.38, fwd: -0.5, a: 0.32, b: 0.38 },
];
const LEG_Y = -0.27;
const STAND = 0.8; // gövde merkezinin zeminden yüksekliği (ölçek 1)

/** Kesiti yanlardan basık, alt yanları (pleura) aşağı sarkan tüp */
function loft(L, rx, ry, prof, rings = 10, radial = 14, pleura = 1.12) {
  const pos = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, k = prof(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const s = Math.sin(a), c = Math.cos(a);
      const x = rx * k * s * (c < 0 ? 0.78 + 0.22 * (1 + c) : 1);
      const y = c > 0 ? ry * k * c : ry * k * pleura * c;
      pos.push(x, y, -t * L);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function flatBlade(len, w, tip = 0.35) {
  const s = new THREE.Shape();
  s.moveTo(-w * 0.5, 0);
  s.quadraticCurveTo(-w * 0.62, -len * 0.6, -w * tip * 0.5, -len);
  s.quadraticCurveTo(0, -len * 1.06, w * tip * 0.5, -len);
  s.quadraticCurveTo(w * 0.62, -len * 0.6, w * 0.5, 0);
  const g = new THREE.ShapeGeometry(s, 6);
  g.rotateX(-Math.PI / 2); // XZ düzlemi, -Z geriye
  g.scale(1, 1, -1);
  return g;
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const carapace = loft(1.05, 0.19, 0.3, (t) => (t < 0.22 ? 0.4 + 0.6 * Math.pow(t / 0.22, 0.6) : 1 - 0.07 * (t - 0.22)), 14, 18, 1.15);
  const segs = SEG.map((s, i) => loft(s.L + 0.04, s.rx, s.ry, (t) => (i === 5 ? 1 - 0.3 * t : 0.9 + 0.1 * Math.min(1, t / 0.6) - 0.03 * Math.max(0, t - 0.8) / 0.2), 6, 14, s.pl));
  const rostrum = new THREE.ConeGeometry(0.04, 0.48, 6);
  rostrum.rotateX(Math.PI / 2);
  rostrum.scale(0.45, 1, 1);
  const telson = flatBlade(0.36, 0.12, 0.3);
  const uropod = flatBlade(0.38, 0.13, 0.5);
  const legA = new THREE.CylinderGeometry(0.016, 0.013, 1, 5);
  legA.translate(0, -0.5, 0);
  const legB = new THREE.CylinderGeometry(0.012, 0.005, 1, 5);
  legB.translate(0, -0.5, 0);
  const tuft = new THREE.ConeGeometry(0.045, 0.07, 6, 1, true);
  tuft.translate(0, -0.035, 0);
  const pleopod = flatBlade(0.2, 0.06, 0.6);
  const antLong = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.08, 0.1, 0.4), new THREE.Vector3(0.25, 0.2, 0.72),
    new THREE.Vector3(0.48, 0.16, 0.6), new THREE.Vector3(0.68, 0.04, -0.3), new THREE.Vector3(0.85, -0.08, -1.7),
  ]), 28, 0.011, 4);
  const antShort = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.03, 0.1, 0.22), new THREE.Vector3(0.1, 0.2, 0.42),
  ]), 8, 0.012, 4);
  const stalk = new THREE.CylinderGeometry(0.035, 0.04, 0.11, 6);
  stalk.rotateX(Math.PI / 2);
  const eyeGeo = new THREE.SphereGeometry(0.068, 10, 8);
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x060606, clearcoat: 1, roughness: 0.15 });
  SHARED = { carapace, segs, rostrum, telson, uropod, legA, legB, tuft, pleopod, antLong, antShort, stalk, eyeGeo, eyeMat };
  return SHARED;
}

// Kromatofor deseni: cherry'de koyu kırmızı benekler, amano'da yan sıra noktalar ve açık sırt çizgisi
const SHRIMP_FRAG = /* glsl */ `
  {
    float n = shN(vSP * 9.0) * 0.6 + shN(vSP * 23.0) * 0.4;
    if (uAmano < 0.5) {
      float chrom = smoothstep(0.45, 0.85, n);
      diffuseColor.rgb *= mix(1.15, 0.5, chrom);
      diffuseColor.a = mix(diffuseColor.a, 1.0, chrom * 0.4);
    } else {
      vec2 q = vec2(vSP.z * 14.0, vSP.y * 9.0);
      float row = abs(fract(q.y) - 0.5);
      float dash = step(0.5, shH(vec3(floor(q.x), floor(q.y), 1.0))) * smoothstep(0.32, 0.2, length(vec2((fract(q.x) - 0.5) * 0.75, row * 1.4)));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.16, 0.1), dash * 0.85);
      diffuseColor.a = mix(diffuseColor.a, 0.95, dash);
      float dorsal = smoothstep(0.03, 0.012, abs(vSP.x)) * step(0.0, vSP.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.9, 0.78), dorsal * 0.8);
      diffuseColor.a = mix(diffuseColor.a, 0.9, dorsal);
    }
  }
`;

const MATS = {};
function materialsFor(sp) {
  const amano = sp.color ? 1 : 0;
  const key = amano ? 'amano' : 'cherry';
  if (MATS[key]) return MATS[key];
  const col = new THREE.Color(sp.color ?? 0xb3141a);
  const make = (opts, k) => patchUnderwater(new THREE.MeshPhysicalMaterial({
    color: col, transparent: true, side: THREE.DoubleSide, depthWrite: true,
    roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25, ...opts,
  }), {
    key: k,
    uniforms: { uAmano: { value: amano } },
    extra: (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSP = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vSP; uniform float uAmano;
          float shH(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          float shN(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(shH(i), shH(i + vec3(1,0,0)), f.x), mix(shH(i + vec3(0,1,0)), shH(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(shH(i + vec3(0,0,1)), shH(i + vec3(1,0,1)), f.x), mix(shH(i + vec3(0,1,1)), shH(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + SHRIMP_FRAG);
    },
  });
  const mat = make({ opacity: amano ? 0.5 : 0.9 }, 'shrimp-body-' + key);
  const legMat = make({ opacity: amano ? 0.4 : 0.7, clearcoat: 0.2 }, 'shrimp-leg-' + key);
  MATS[key] = { mat, legMat };
  return MATS[key];
}

export const SHRIMP_LABEL = { walk: 'Yürüyor', pick: 'Yüzey temizliyor', eat: 'Artık yiyor', swim: 'Yüzüyor', hide: 'Saklanıyor', sleep: 'Dinleniyor' };

export class Shrimp {
  constructor(data) {
    this.data = data;
    this.sp = SPECIES[data.species] ?? SPECIES.shrimp;
    const s = shared();
    const m = materialsFor(this.sp);
    this.group = new THREE.Group();
    const scale = (data.size ?? 1) * (this.sp.size ?? 1) * 0.95;
    this.group.scale.setScalar(scale);
    this.total = 2.7 * scale;
    this.stand = STAND * scale;
    const mesh = (g, mat, parent) => { const o = new THREE.Mesh(g, mat); o.castShadow = true; parent.add(o); return o; };

    // gövde: kabuk + karın halkaları zinciri (her halka kendi ekleminde döner)
    const head = new THREE.Group();
    head.position.z = 1.2;
    this.group.add(head);
    mesh(s.carapace, m.mat, head);
    const ros = mesh(s.rostrum, m.mat, head);
    ros.position.set(0, 0.1, 0.2);
    ros.rotation.x = -0.12;
    this.segs = [];
    let parent = new THREE.Group();
    parent.position.set(0, 0.0, 1.2 - 1.05 + 0.04);
    this.group.add(parent);
    SEG.forEach((d, i) => {
      const joint = i === 0 ? parent : new THREE.Group();
      if (i > 0) { joint.position.z = -SEG[i - 1].L; parent.add(joint); }
      mesh(s.segs[i], m.mat, joint);
      // yüzme bacakları (ilk 5 halkanın altında)
      if (i < 5) for (const side of [-1, 1]) {
        const pl = mesh(s.pleopod, m.legMat, joint);
        pl.position.set(side * d.rx * 0.45, -d.ry * 0.95, -d.L * 0.45);
        pl.userData = { i, side };
        (this.pleo ??= []).push(pl);
      }
      this.segs.push(joint);
      parent = joint;
    });
    // kuyruk yelpazesi
    const fan = new THREE.Group();
    fan.position.z = -SEG[5].L;
    parent.add(fan);
    mesh(s.telson, m.mat, fan);
    this.uropods = [];
    for (const side of [-1, 1]) for (const k of [0, 1]) {
      const u = mesh(s.uropod, m.mat, fan);
      u.position.set(side * 0.03, -0.01 - k * 0.012, 0.02);
      u.userData = { side, k };
      this.uropods.push(u);
    }

    // yürüme bacakları: kalça → uyluk → diz → baldır
    this.legs = [];
    LEGS.forEach((d, i) => {
      for (const side of [-1, 1]) {
        const hip = new THREE.Group();
        hip.rotation.order = 'YZX';
        hip.position.set(side * 0.1, LEG_Y, d.z);
        this.group.add(hip);
        const fem = mesh(s.legA, m.legMat, hip);
        fem.scale.y = d.a;
        const knee = new THREE.Group();
        knee.position.y = -d.a;
        hip.add(knee);
        const tib = mesh(s.legB, m.legMat, knee);
        tib.scale.y = d.b;
        if (d.chela) {
          const tf = mesh(s.tuft, m.legMat, knee);
          tf.position.y = -d.b;
        }
        this.legs.push({ hip, knee, side, i, d });
      }
    });

    // gözler, antenler
    this.ants = [];
    this.antennules = [];
    for (const side of [-1, 1]) {
      const st = mesh(s.stalk, m.mat, head);
      st.position.set(side * 0.1, 0.07, 0.03);
      st.rotation.y = side * 0.5;
      const e = new THREE.Mesh(s.eyeGeo, s.eyeMat);
      e.position.set(side * 0.15, 0.08, 0.08);
      head.add(e);
      const a = mesh(s.antLong, m.legMat, head);
      a.position.set(side * 0.06, -0.06, 0.02);
      a.scale.x = side;
      a.castShadow = false;
      this.ants.push(a);
      for (const k of [0, 1]) {
        const b = mesh(s.antShort, m.legMat, head);
        b.position.set(side * 0.04, 0.02, 0.1);
        b.scale.x = side * (k ? 1.6 : 0.7);
        b.castShadow = false;
        this.antennules.push(b);
      }
    }

    const p = data.pos ?? [(Math.random() - 0.5) * 40, 0, (Math.random() - 0.5) * 20];
    this.pos = new THREE.Vector3(p[0], 0, p[2]);
    this.pos.y = sandHeight(this.pos.x, this.pos.z) + this.stand;
    this.heading = Math.random() * Math.PI * 2;
    this.target = new THREE.Vector3();
    this.timer = 0;
    this.state = 'pick';
    this.t = Math.random() * 10;
    this.hop = 0;
    this.flip = 0;
    this.gait = 0;
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
        let dh = Math.atan2(dx, dz) - this.heading;
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
    // kaçış: karın hızla kıvrılır, karides geriye doğru fırlar (kuyruk çırpma)
    if (this.flee > 0) speed = -this.sp.burst * Math.max(0.25, this.flip / 0.3);
    this.flip = Math.max(0, this.flip - dt);
    this.pos.x += Math.sin(this.heading) * speed * dt;
    this.pos.z += Math.cos(this.heading) * speed * dt;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -HALF_W + 1.5, HALF_W - 1.5);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -HALF_D + 1.5, HALF_D - 1.5);
    for (const ob of world.obstacles) {
      const dx = this.pos.x - ob.pos.x, dz = this.pos.z - ob.pos.z;
      const L = Math.hypot(dx, dz);
      if (ob.top && L < ob.r * 0.8 && L > 1e-3) { this.pos.x += dx / L * dt * 3; this.pos.z += dz / L * dt * 3; }
    }
    this.hop = Math.max(0, this.hop - dt);
    const ground = sandHeight(this.pos.x, this.pos.z) + this.stand;
    const swimY = this.state === 'swim' ? Math.sin(Math.min(this.hop, 1.5) / 1.5 * Math.PI) * 4 : 0;
    this.pos.y = THREE.MathUtils.lerp(this.pos.y, ground + swimY, 0.15);

    const ahead = sandHeight(this.pos.x + Math.sin(this.heading), this.pos.z + Math.cos(this.heading));
    const pitch = -Math.atan2(ahead - (ground - this.stand), 1) * 0.8;
    this.group.position.copy(this.pos);
    this.group.rotation.set(pitch, this.heading, 0, 'YXZ');
    containGroup(this.group, this.pos);
    this.animate(dt, speed);
  }

  animate(dt, speed) {
    const t = this.t;
    const swim = this.state === 'swim';
    const walking = Math.abs(speed) > 0.1 && !swim;
    const picking = this.state === 'pick' || this.state === 'eat' || (this.state === 'walk' && !walking);
    this.gait += dt * (walking ? 4.5 + Math.abs(speed) * 2 : 0);
    const curl = this.flip > 0 ? Math.sin((1 - this.flip / 0.3) * Math.PI) : 0;
    const breathe = Math.sin(t * 1.7) * 0.015;

    // karın: dinlenme kavsi, yüzerken hafif dalga, kaçışta sert kıvrılma
    this.segs.forEach((j, i) => {
      const wave = swim ? Math.sin(t * 9 - i * 0.7) * 0.05 : 0;
      j.rotation.x = SEG[i].rest + breathe + wave - curl * (i < 2 ? 0.25 : 0.6);
    });
    const spread = swim || curl > 0 ? 1 : 0.35;
    for (const u of this.uropods) {
      const { side, k } = u.userData;
      u.rotation.y = side * (0.18 + k * 0.28) * (0.6 + spread * 0.7);
      u.rotation.z = side * 0.1;
    }
    // yüzme bacakları: metakronal dalga, dinlenirken de solunum için yavaşça çırpar
    const pw = swim ? 18 : walking ? 4 : 2.2, pa = swim ? 0.65 : 0.22;
    for (const pl of this.pleo) {
      const { i, side } = pl.userData;
      pl.rotation.x = -0.9 - Math.sin(t * pw - i * 0.85) * pa;
      pl.rotation.z = side * 0.15;
    }
    // yürüme bacakları
    for (const L of this.legs) {
      const { hip, knee, side, i, d } = L;
      let yaw = d.fwd, splay = 0.95, bend = 0.8;
      if (swim || curl > 0) {
        // yüzerken bacaklar geriye ve gövdeye katlanır
        yaw = d.fwd * 0.3 - 0.6; splay = 0.5; bend = 1.2;
      } else if (d.chela && picking) {
        // kıskaçlar sırayla zemini tarar ve ağza götürür
        const ph = t * 7.5 + (side > 0 ? Math.PI : 0) + i * 1.3;
        const p = 0.5 + 0.5 * Math.sin(ph);
        yaw = d.fwd + 0.15 - p * 0.35;
        splay = 0.55 + (1 - p) * 0.35;
        bend = 0.3 + p * 1.3;
      } else if (walking) {
        const ph = this.gait + i * 1.25 + (side > 0 ? Math.PI : 0);
        yaw = d.fwd + Math.sin(ph) * 0.32;
        const lift = Math.max(0, Math.cos(ph));
        splay = 0.95 + lift * 0.25;
        bend = 0.8 + lift * 0.35;
      } else if (d.chela) {
        yaw = d.fwd; splay = 0.6; bend = 0.9;
      }
      hip.rotation.y = -side * yaw;
      hip.rotation.z = side * splay;
      knee.rotation.z = -side * bend;
    }
    // antenler sürekli tarar, antencikler ara ara seğirir
    this.ants.forEach((a, k) => {
      a.rotation.y = Math.sin(t * 1.1 + k * 2.1) * 0.22 * (k ? 1 : -1);
      a.rotation.x = Math.sin(t * 0.8 + k) * 0.12 + (swim ? 0.25 : 0);
    });
    this.antennules.forEach((b, k) => {
      const flick = Math.pow(Math.max(0, Math.sin(t * 2.3 + k * 1.7)), 12);
      b.rotation.x = -flick * 0.5;
    });
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
    this.flee = 0.55;
    this.flip = 0.3;
    // tehdide dönük kalıp geriye fırlar
    const away = new THREE.Vector3().subVectors(this.pos, from).setY(0).normalize();
    this.heading = Math.atan2(-away.x, -away.z);
    this.hop = 1;
    this.data.stress = Math.min(100, this.data.stress + 4);
  }

  serialize() {
    this.data.pos = [this.pos.x, this.pos.y, this.pos.z].map((v) => Math.round(v * 10) / 10);
    return this.data;
  }
  dispose() {}
}
