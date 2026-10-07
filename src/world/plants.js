import * as THREE from 'three';
import { patchUnderwater } from '../render/water.js';
import { mulberry } from '../render/textures.js';
import { sandHeight } from './substrate.js';

export const PLANT_TYPES = {
  vallisneria: { name: 'Vallisneria', price: 6, desc: 'Uzun, şerit yapraklı çim bitkisi. Hızlı büyür, suyu temizler.', o2: 1.2, uptake: 1.3 },
  javafern: { name: 'Java eğrelti otu', price: 10, desc: 'Dayanıklı, mızrak yapraklı. Kök ve taşa tutunur.', o2: 0.8, uptake: 0.8 },
  anubias: { name: 'Anubias', price: 12, desc: 'Koyu ve parlak yapraklı, çok yavaş büyür, neredeyse ölümsüz.', o2: 0.6, uptake: 0.5 },
};

// --- Yaprak geometrileri (yerel uzay: taban orijinde, yaprak +Y yönünde uzar) ---
function ribbonGeometry() {
  const segs = 14;
  const g = new THREE.PlaneGeometry(1, 1, 1, segs);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i);
    const w = 0.55 * (1 - Math.pow(t, 6) * 0.9);
    p.setX(i, p.getX(i) * w);
    p.setZ(i, (p.getX(i) === 0 ? 0 : Math.abs(p.getX(i))) * 0.15);
  }
  g.computeVertexNormals();
  return g;
}

function lanceGeometry({ width = 0.24, petiole = 0.08, fold = 0.25, segs = 16, oval = false } = {}) {
  const cols = 4;
  const verts = [], uvs = [], idx = [];
  for (let j = 0; j <= segs; j++) {
    const t = j / segs;
    let w;
    if (t < petiole) w = 0.012;
    else {
      const u = (t - petiole) / (1 - petiole);
      w = oval
        ? width * Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.pow(u, 0.85))))
        : width * Math.sin(Math.PI * Math.pow(u, 0.6)) * (1 - u * 0.25);
      w = Math.max(w, 0.005);
    }
    for (let i = 0; i <= cols; i++) {
      const s = i / cols * 2 - 1;
      const x = s * w;
      const z = Math.abs(s) * w * fold - Math.sin(t * Math.PI) * 0.04; // V katlanması + hafif kavis
      verts.push(x, t, z);
      uvs.push(i / cols, t);
    }
  }
  for (let j = 0; j < segs; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + cols + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Salınım ve sağlık rengi için ortak shader eki
function plantShader(kind) {
  return (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        attribute vec4 aInfo; // x: faz, y: sağlık, z: esneklik, w: boy
        varying vec2 vLeafUv;
        varying float vHealth;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLeafUv = uv;
        vHealth = aInfo.y;
        {
          float t = uv.y;
          float ph = aInfo.x;
          float k = aInfo.z;
          float w1 = sin(uTime * 0.9 + ph + t * 2.2) * 0.6 + sin(uTime * 1.7 + ph * 1.3 + t * 4.0) * 0.25;
          float bend = t * t * k;
          transformed.x += w1 * bend * 0.35;
          transformed.z += (cos(uTime * 0.7 + ph) * 0.4 + 0.35) * bend * 0.3;
          ${kind === 'ribbon' ? 'transformed.x += sin(t * 3.0 + ph) * t * 0.04; transformed.y -= bend * 0.08 * (1.0 + 0.5 * sin(uTime * 0.5 + ph));' : ''}
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vLeafUv;
        varying float vHealth;
        float ph21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 17853.3); }
        float pnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(ph21(i), ph21(i+vec2(1,0)), f.x), mix(ph21(i+vec2(0,1)), ph21(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 lu = vLeafUv;
          float mid = abs(lu.x - 0.5) * 2.0;
          ${kind === 'ribbon'
            ? 'float vein = 0.92 + 0.08 * sin(lu.x * 40.0); float tipBrown = smoothstep(0.85, 1.0, lu.y) * 0.25;'
            : 'float vein = 1.0 - (1.0 - smoothstep(0.0, 0.08, mid)) * 0.35 + 0.08 * smoothstep(0.85, 1.0, sin((lu.y * 22.0 - mid * 6.0)) ); float tipBrown = 0.0;'}
          diffuseColor.rgb *= vein;
          // kenara ve uca doğru açık ton
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.3, 0.9), smoothstep(0.6, 1.0, mid) * 0.4);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.26, 0.1), tipBrown);
          // sağlıksız: sararma ve solma
          float sick = clamp(1.0 - vHealth, 0.0, 1.0);
          float spots = smoothstep(0.55, 0.75, pnoise(lu * vec2(9.0, 30.0)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.48, 0.16), sick * (0.6 + spots * 0.4));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.16, 0.08), sick * sick * spots);
          // yosun kaplaması
          float alg = smoothstep(0.35, 0.8, pnoise(vWPos.xz * 1.7 + vWPos.y) * 0.6 + pnoise(lu * 18.0) * 0.5) * uAlgae;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.24, 0.08), alg * 0.75);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // ışık arkadan geçtiğinde yaprak dokusundan sızan yeşil (sahte translucency)
        totalEmissiveRadiance += diffuseColor.rgb * vec3(0.25, 0.55, 0.15) * uLamp * 0.18 * (1.0 - abs(vLeafUv.x - 0.5));`);
  };
}

function makeMaterial(kind, opts) {
  const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...opts });
  return patchUnderwater(m, { key: 'plant-' + kind, extra: plantShader(kind) });
}

class LeafPool {
  constructor(geo, mat, cap) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.info = new Float32Array(cap * 4);
    this.infoAttr = new THREE.InstancedBufferAttribute(this.info, 4);
    this.infoAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aInfo', this.infoAttr);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.free = [];
  }
  alloc() {
    if (this.free.length) return this.free.pop();
    if (this.mesh.count >= this.cap) return -1;
    return this.mesh.count++;
  }
  release(i) {
    this.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    this.free.push(i);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export function createPlants(scene) {
  const group = new THREE.Group();
  const pools = {
    vallisneria: new LeafPool(ribbonGeometry(), makeMaterial('ribbon', { color: 0x5f9a38, roughness: 0.55 }), 600),
    javafern: new LeafPool(lanceGeometry({ width: 0.15, petiole: 0.12, fold: 0.35 }), makeMaterial('fern', { color: 0x2f5a22, roughness: 0.5 }), 400),
    anubias: new LeafPool(lanceGeometry({ width: 0.3, petiole: 0.35, fold: 0.12, oval: true }), makeMaterial('anubias', { color: 0x1f4219, roughness: 0.28, metalness: 0.0 }), 300),
  };
  for (const p of Object.values(pools)) group.add(p.mesh);

  // Rizom / kök topakları
  const rhizomeMat = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x3e3420, roughness: 0.9 }), { key: 'rhizome' });
  const rhizomeGeo = new THREE.CapsuleGeometry(0.35, 2.2, 4, 8);
  rhizomeGeo.rotateZ(Math.PI / 2);

  const plants = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const col = new THREE.Color();

  function layout(plant) {
    const pool = pools[plant.type];
    const g = plant.growth;
    for (const leaf of plant.leaves) {
      e.set(leaf.tilt, leaf.yaw, leaf.roll, 'YXZ');
      q.setFromEuler(e);
      pos.set(plant.x + leaf.ox, plant.y + leaf.oy, plant.z + leaf.oz);
      const len = leaf.len * (0.35 + 0.65 * g);
      scl.set(leaf.wid * (0.6 + 0.4 * g) * (plant.type === 'vallisneria' ? 1 : len), len, plant.type === 'vallisneria' ? 1 : len);
      m4.compose(pos, q, scl);
      pool.mesh.setMatrixAt(leaf.i, m4);
      pool.info[leaf.i * 4 + 0] = leaf.phase;
      pool.info[leaf.i * 4 + 1] = plant.health;
      pool.info[leaf.i * 4 + 2] = leaf.flex;
      pool.info[leaf.i * 4 + 3] = len;
    }
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.infoAttr.needsUpdate = true;
  }

  function add(type, x, z, { growth = 0.6, health = 1, seed = Math.floor(Math.random() * 1e9), y = null } = {}) {
    const r = mulberry(seed);
    const pool = pools[type];
    const base = y ?? sandHeight(x, z) - 0.3;
    const plant = { id: seed, type, x, z, y: base, growth, health, seed, leaves: [], extra: [] };
    let n;
    if (type === 'vallisneria') {
      n = 9 + Math.floor(r() * 6);
      for (let k = 0; k < n; k++) {
        const a = r() * Math.PI * 2, rad = r() * 2.2;
        plant.leaves.push({
          ox: Math.cos(a) * rad, oy: 0, oz: Math.sin(a) * rad,
          yaw: r() * Math.PI, tilt: (r() - 0.5) * 0.25, roll: (r() - 0.5) * 0.3,
          len: 16 + r() * 16, wid: 0.9 + r() * 0.5, flex: 2.5 + r() * 2.5, phase: r() * 6.28,
        });
      }
    } else if (type === 'javafern') {
      n = 9 + Math.floor(r() * 5);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + r() * 0.5;
        plant.leaves.push({
          ox: (r() - 0.5) * 2, oy: r() * 0.3, oz: (r() - 0.5) * 0.8,
          yaw: a, tilt: 0.35 + r() * 0.55, roll: (r() - 0.5) * 0.4,
          len: 7 + r() * 6, wid: 1, flex: 0.6 + r() * 0.5, phase: r() * 6.28,
        });
      }
    } else {
      n = 6 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + r() * 0.6;
        plant.leaves.push({
          ox: (r() - 0.5) * 2.2, oy: r() * 0.2, oz: (r() - 0.5) * 0.8,
          yaw: a, tilt: 0.55 + r() * 0.5, roll: (r() - 0.5) * 0.3,
          len: 6 + r() * 3.5, wid: 1, flex: 0.25 + r() * 0.2, phase: r() * 6.28,
        });
      }
    }
    for (const leaf of plant.leaves) {
      leaf.i = pool.alloc();
      const c = type === 'vallisneria' ? col.setHSL(0.26 + r() * 0.04, 0.45, 0.32 + r() * 0.1) : col.setHSL(0.3 + r() * 0.03, 0.4 + r() * 0.1, 0.2 + r() * 0.08);
      if (leaf.i >= 0) pool.mesh.setColorAt(leaf.i, c);
    }
    plant.leaves = plant.leaves.filter((l) => l.i >= 0);
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;

    if (type !== 'vallisneria') {
      const rh = new THREE.Mesh(rhizomeGeo, rhizomeMat);
      rh.position.set(x, base + 0.25, z);
      rh.rotation.y = r() * Math.PI;
      rh.castShadow = true;
      group.add(rh);
      plant.extra.push(rh);
    }
    layout(plant);
    plants.push(plant);
    return plant;
  }

  function remove(plant) {
    const pool = pools[plant.type];
    for (const leaf of plant.leaves) pool.release(leaf.i);
    for (const o of plant.extra) group.remove(o);
    plants.splice(plants.indexOf(plant), 1);
  }

  scene.add(group);
  return { group, plants, add, remove, layout, pools };
}
