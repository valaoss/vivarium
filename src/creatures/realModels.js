import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { patchUnderwater } from '../render/water.js';
import { SWIM_VERT_DECL, SWIM_VERT, PATTERN_DECL, FISH_SHARED } from './fishMaterial.js';
import { SPECIES } from './species.js';

/*
 * Gerçek balık modelleri (Sketchfab, CC-BY). İskeletli modeller bind pozunda
 * düz geometriye çevrilir, burun +Z, sırt +Y olacak şekilde hizalanır ve
 * prosedürel balıklarla aynı yüzme shader'ı (aSeg) uygulanır. Böylece davranış,
 * dönüş kıvrımı ve hız animasyonu aynen çalışır.
 */
export const REAL_FISH = {};
if (typeof window !== "undefined") window.__REAL_FISH = REAL_FISH;

// axis: modelin boy ekseni ('x' | 'z'); flip: burun eksi yöndeyse
const SOURCES = {
  neon: {
    species: 'neon', axis: 'z',
    url: 'models/fish/neon/scene.gltf',
    credit: '“Paracheirodon Innesi _ Tetra Neon” — BlueMesh (CC-BY 4.0)',
  },
  guppy: {
    species: 'guppy', axis: 'z', flip: true,
    url: 'models/creatures/guppy.glb',
    credit: '“Guppy Fish” — BlueMesh (CC-BY 4.0)',
  },
  guppy_f: {
    species: 'guppy', axis: 'z',
    url: 'models/creatures/guppy_female.glb',
    credit: '“Guppy ♀” — Nestaeric (CC-BY 4.0)',
  },
  betta: {
    species: 'betta', axis: 'z',
    url: 'models/creatures/betta.glb',
    credit: '“Betta Splendens” — BlueMesh (CC-BY 4.0)',
  },
  swordtail: {
    species: 'swordtail', axis: 'x', flip: true, exclude: ['Material.001'],
    url: 'models/creatures/swordtail.glb',
    credit: '“CC0 Green Swordtail, Xiphophorus helleri” — ffishAsia & floraZia (CC0)',
  },
};

/** Bir balık için kullanılacak model anahtarı (yoksa null → prosedürel) */
export function realModelKey(species, sex) {
  if (species === 'guppy' && sex === 'f' && REAL_FISH.guppy_f) return 'guppy_f';
  return REAL_FISH[species] ? species : null;
}

export function loadRealFish() {
  const loader = new GLTFLoader();
  const jobs = Object.entries(SOURCES).map(([key, src]) => new Promise((resolve) => {
    loader.load(`${import.meta.env.BASE_URL}${src.url}`, (gltf) => {
      try { REAL_FISH[key] = prepare(gltf, key, src); } catch (e) { console.warn('Model hazırlanamadı', key, e); }
      resolve();
    }, undefined, () => resolve());
  }));
  return Promise.all(jobs);
}

function prepare(gltf, key, src) {
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    if (src.exclude?.includes(o.material?.name)) return;
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) if (o.geometry.attributes[name]) g.setAttribute(name, o.geometry.attributes[name].clone());
    if (o.geometry.index) g.setIndex(o.geometry.index.clone());
    g.applyMatrix4(o.matrixWorld);
    // boy ekseni +Z (burun) olacak şekilde döndür
    if (src.axis === 'x') g.rotateY(-Math.PI / 2);
    if (src.flip) g.rotateY(Math.PI);
    parts.push({ name: o.name, geo: g, material: o.material });
  });
  // En büyük parça gövde; ekseni ve baş yönünü ona göre belirle
  parts.sort((a, b) => b.geo.attributes.position.count - a.geo.attributes.position.count);
  const box = new THREE.Box3();
  for (const p of parts) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const b = SPECIES[src.species].body;
  const total = b.length + b.tailLen;
  const scale = total / size.z;
  for (const p of parts) {
    p.geo.translate(-center.x, -center.y, -center.z);
    p.geo.scale(scale, scale, scale);
    p.geo.computeBoundingBox();
  }
  const half = (size.z * scale) / 2;
  const halfH = (size.y * scale) / 2;
  for (const p of parts) {
    const pos = p.geo.attributes.position;
    const seg = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      seg[i * 4] = (half - pos.getZ(i)) / (2 * half);   // 0 burun .. 1 kuyruk ucu
      seg[i * 4 + 1] = pos.getY(i) / halfH;
    }
    p.geo.setAttribute('aSeg', new THREE.BufferAttribute(seg, 4));
    if (!p.geo.attributes.normal) p.geo.computeVertexNormals();
  }
  return { parts, total, credit: src.credit };
}

const REAL_FRAG = /* glsl */ `
  {
    float u = vSeg.x / uBodyFrac;
    float v = vSeg.y;
    vec3 c = diffuseColor.rgb;
    float ich = smoothstep(0.8, 0.88, fn(vec2(u * 60.0, v * 18.0) + uSeed * 3.0)) * uIch;
    c = mix(c, vec3(0.95, 0.95, 0.92), ich * step(0.3, diffuseColor.a));
    float g = dot(c, vec3(0.3, 0.59, 0.11));
    c = mix(c, vec3(g) * 0.9, uPale * 0.6);
    c = mix(c, c * 0.8 + vec3(0.03, 0.04, 0.05), uNight * 0.3);
    diffuseColor.rgb = c;
  }
`;

/** Her balık için malzemeleri kopyalar (uniform'lar balığa özel). */
export function makeRealFishMeshes(key, fishUniforms) {
  const real = REAL_FISH[key];
  return real.parts.map((p) => {
    // Fotogrametri taramaları ışıksız (unlit) gelir: sahne ışığını alsın
    const m = p.material.isMeshBasicMaterial
      ? new THREE.MeshStandardMaterial({ map: p.material.map, roughness: 0.55, metalness: 0 })
      : p.material.clone();
    m.side = THREE.DoubleSide;
    m.transparent = true;
    m.depthWrite = true;
    m.alphaTest = 0.04;
    patchUnderwater(m, {
      key: 'real-fish',
      uniforms: { ...fishUniforms, ...FISH_SHARED },
      extra: (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\n' + SWIM_VERT_DECL)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWIM_VERT);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\n' + PATTERN_DECL)
          .replace('#include <color_fragment>', '#include <color_fragment>\n' + REAL_FRAG)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            totalEmissiveRadiance += vec3(0.25, 0.6, 1.0) * uHighlight * 0.12;`);
      },
    });
    const mesh = new THREE.Mesh(p.geo, m);
    mesh.castShadow = true;
    mesh.renderOrder = 7;
    return mesh;
  });
}

export function realCredits() {
  return Object.values(REAL_FISH).map((r) => r.credit);
}
