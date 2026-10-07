import * as THREE from 'three';
import { TANK, HALF_W, HALF_D } from '../config.js';
import { SPECIES } from './species.js';
import { sandHeight } from '../world/substrate.js';
import { patchUnderwater } from '../render/water.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Gerçek nerit kabuğu taraması (RISD Nature Lab, CC-BY). Yüklenemezse prosedürel kabuk kalır.
let SCAN = null;
export function loadSnailShell() {
  return new Promise((resolve) => {
    new GLTFLoader().load(`${import.meta.env.BASE_URL}models/creatures/nerite.glb`, (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      let src = null;
      gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
      const geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
      geo.computeBoundingBox();
      const b = geo.boundingBox, size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      // tabanı y=0, en uzun yatay eksen +Z olacak şekilde hizala; boy 2.2 birim
      geo.translate(-c.x, -b.min.y, -c.z);
      if (size.x > size.z) geo.rotateY(Math.PI / 2);
      const k = 2.2 / Math.max(size.x, size.z);
      geo.scale(k, k, k);
      geo.computeVertexNormals();
      const mat = patchUnderwater(new THREE.MeshPhysicalMaterial({
        map: src.material.map, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3,
      }), {
        key: 'snailshell-scan',
        extra: (sh) => {
          // Neritina natalensis: beyaz bantları zeytin-altın tonuna çevir (zebra nerit)
          sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
            { float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
              diffuseColor.rgb = mix(vec3(0.02, 0.018, 0.012), vec3(0.62, 0.48, 0.12), smoothstep(0.08, 0.5, l)); }`);
        },
      });
      SCAN = { geo, mat };
      resolve();
    }, undefined, () => resolve());
  });
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  // Nerit kabuğu: basık kubbe, tepeden kenara uzanan zigzag zebra çizgileri
  const shell = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const p = shell.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    // spiral kubbe: bir yana doğru asimetrik
    v.y *= 0.72;
    v.x *= 1.05;
    v.z += v.y * 0.25;
    p.setXYZ(i, v.x, v.y, v.z);
    const ang = Math.atan2(v.z, v.x);
    const rad = Math.hypot(v.x, v.z);
    const zig = Math.sin(ang * 11 + Math.sin(rad * 14) * 1.2);
    const dark = zig > 0.15 ? 1 : 0;
    const c = dark ? [0.05, 0.04, 0.03] : [0.78, 0.62, 0.18];
    col.set(c, i * 3);
  }
  shell.setAttribute('color', new THREE.BufferAttribute(col, 3));
  shell.computeVertexNormals();
  const shellMat = patchUnderwater(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, clearcoat: 0.6 }), { key: 'snailshell' });
  const foot = new THREE.CapsuleGeometry(0.55, 1.5, 4, 12);
  foot.rotateX(Math.PI / 2);
  foot.scale(1, 0.4, 1);
  const footMat = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x8c8478, roughness: 0.6 }), { key: 'snailfoot' });
  const tent = new THREE.CylinderGeometry(0.04, 0.07, 0.8, 6);
  tent.translate(0, 0.4, 0);
  SHARED = { shell, shellMat, foot, footMat, tent };
  return SHARED;
}

export const SNAIL_LABEL = { crawl: 'Sürünüyor', graze: 'Yosun kazıyor', climb: 'Camda geziyor', rest: 'Kabuğuna çekilmiş' };

/**
 * Kumda ve ön camın iç yüzünde yavaşça gezer. Camdayken geçtiği yerdeki
 * yosunu temizler (world.cleanGlass).
 */
export class Snail {
  constructor(data) {
    this.data = data;
    this.sp = SPECIES.snail;
    const s = shared();
    this.group = new THREE.Group();
    const scale = (data.size ?? 1) * 0.85;
    this.total = 2 * scale;
    this.body = new THREE.Group();
    const shell = SCAN ? new THREE.Mesh(SCAN.geo, SCAN.mat) : new THREE.Mesh(s.shell, s.shellMat);
    shell.position.y = SCAN ? 0.1 : 0.35;
    shell.castShadow = true;
    const foot = new THREE.Mesh(s.foot, s.footMat);
    foot.position.set(0, 0.2, 0.25);
    if (SCAN) { foot.scale.set(0.85, 0.8, 0.72); foot.position.set(0, 0.16, 0.2); }
    this.body.add(shell, foot);
    this.tents = [];
    for (const side of [-1, 1]) {
      const t = new THREE.Mesh(s.tent, s.footMat);
      t.position.set(side * 0.25, 0.3, 1.1);
      t.rotation.set(1.1, 0, side * 0.35);
      this.tents.push(t);
      this.body.add(t);
    }
    this.body.scale.setScalar(scale);
    this.group.add(this.body);

    const p = data.pos ?? [(Math.random() - 0.5) * 40, 0, (Math.random() - 0.5) * 16];
    this.surface = data.surface ?? 'sand';
    this.pos = new THREE.Vector3(...p);
    this.heading = Math.random() * Math.PI * 2;
    this.timer = 0;
    this.state = 'crawl';
    this.t = Math.random() * 10;
    this.u = { uHighlight: { value: 0 } };
    this.snap();
  }

  get species() { return 'snail'; }
  get radius() { return this.total * 0.6; }

  snap() {
    if (this.surface === 'glass') {
      this.pos.z = HALF_D - 0.08;
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, -HALF_W + 1.5, HALF_W - 1.5);
      this.pos.y = THREE.MathUtils.clamp(this.pos.y, sandHeight(this.pos.x, HALF_D - 1) + 0.5, TANK.water - 1.5);
    } else {
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, -HALF_W + 1.5, HALF_W - 1.5);
      this.pos.z = THREE.MathUtils.clamp(this.pos.z, -HALF_D + 1.5, HALF_D - 1.2);
      this.pos.y = sandHeight(this.pos.x, this.pos.z);
    }
  }

  update(dt, world) {
    this.t += dt;
    this.timer -= dt;
    const night = world.night > 0.6;
    if (this.timer < 0) {
      this.timer = 6 + Math.random() * 10;
      const r = Math.random();
      this.state = r < 0.15 ? 'rest' : r < 0.55 ? 'graze' : 'crawl';
      this.heading += (Math.random() - 0.5) * 2.5;
      // kum → cam: ön cama yakınken tırmanmaya başla; camdayken ara sıra in
      if (this.surface === 'sand' && this.pos.z > HALF_D - 4 && Math.random() < 0.6) {
        this.surface = 'glass';
        this.heading = (Math.random() - 0.5) * 1.2; // yukarı doğru
        this.snap();
      } else if (this.surface === 'glass' && Math.random() < 0.12) {
        this.surface = 'sand';
        this.pos.z = HALF_D - 2;
        this.heading = Math.PI + (Math.random() - 0.5);
        this.snap();
      } else if (this.surface === 'sand' && Math.random() < 0.4) {
        this.heading = (Math.random() - 0.5) * 1.4; // cama doğru yönel
      }
    }
    const speed = this.state === 'rest' ? 0 : this.sp.cruise * (this.state === 'graze' ? 0.5 : 1) * (night ? 1.3 : 1);
    if (this.surface === 'glass') {
      // camda: x yana, y yukarı (heading 0 = yukarı)
      this.pos.x += Math.sin(this.heading) * speed * dt;
      this.pos.y += Math.cos(this.heading) * speed * dt;
      if (this.pos.y > TANK.water - 1.6 || this.pos.x < -HALF_W + 2 || this.pos.x > HALF_W - 2) this.heading += Math.PI * dt;
      this.snap();
      if (speed > 0 && world.cleanGlass) {
        const cleaned = world.cleanGlass(this.pos.x, this.pos.y, dt * (this.state === 'graze' ? 0.5 : 0.25));
        if (cleaned > 0.002) {
          this.data.hunger = Math.max(0, this.data.hunger - cleaned * 20);
          if (!this.reported) { this.reported = true; world.events.push({ type: 'snailGlass', fish: this }); }
        }
      }
      // yönelim: ayak cama (+z), kabuk tankın içine (-z) bakar
      const up = new THREE.Vector3(0, 0, -1);
      const fwd = new THREE.Vector3(Math.sin(this.heading), Math.cos(this.heading), 0);
      const right = new THREE.Vector3().crossVectors(up, fwd);
      this.group.position.copy(this.pos);
      this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
    } else {
      this.pos.x += Math.sin(this.heading) * speed * dt;
      this.pos.z += Math.cos(this.heading) * speed * dt;
      for (const ob of world.obstacles) {
        if (!ob.top) continue;
        const dx = this.pos.x - ob.pos.x, dz = this.pos.z - ob.pos.z, L = Math.hypot(dx, dz);
        if (L < ob.r * 0.8 && L > 1e-3) { this.pos.x += dx / L * dt; this.pos.z += dz / L * dt; this.heading += dt; }
      }
      if (Math.abs(this.pos.x) > HALF_W - 2 || this.pos.z < -HALF_D + 2) this.heading += Math.PI * dt;
      this.snap();
      // zemin eğimine uy
      const ahead = sandHeight(this.pos.x + Math.sin(this.heading), this.pos.z + Math.cos(this.heading));
      const pitch = -Math.atan2(ahead - this.pos.y, 1);
      this.group.position.copy(this.pos);
      this.group.quaternion.setFromEuler(new THREE.Euler(pitch, this.heading, 0, 'YXZ'));
      // yerde yosun ve artık yiyerek doyar
      if (speed > 0) this.data.hunger = Math.max(0, this.data.hunger - dt * 0.02 * (world.algae ?? 0.3));
    }
    // dinlenirken kabuğa çekilir
    const k = this.state === 'rest' ? 0.85 : 1;
    this.body.children[1].scale.setScalar(THREE.MathUtils.lerp(this.body.children[1].scale.x, k, 0.05));
    this.tents.forEach((t, i) => {
      t.scale.y = THREE.MathUtils.lerp(t.scale.y, this.state === 'rest' ? 0.2 : 1, 0.05);
      t.rotation.y = Math.sin(this.t * 0.8 + i * 2) * 0.3;
    });
  }

  scare() {
    this.state = 'rest';
    this.timer = 3;
  }

  serialize() {
    this.data.pos = [this.pos.x, this.pos.y, this.pos.z].map((v) => Math.round(v * 10) / 10);
    this.data.surface = this.surface;
    return this.data;
  }
  dispose() {}
}
