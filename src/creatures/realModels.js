import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { patchUnderwater } from '../render/water.js';
import { SWIM_VERT_DECL, SWIM_VERT, PATTERN_DECL, FISH_SHARED, MOUTH_FRAG } from './fishMaterial.js';
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
    species: 'guppy', axis: 'z', flip: true, exclude: ['Circle002_0', 'Circle003_0'],
    url: 'models/creatures/guppy.glb',
    credit: '“Guppy Fish” — BlueMesh (CC-BY 4.0)',
  },
  guppy_f: {
    species: 'guppy', axis: 'z', exclude: ['Object_11'],
    url: 'models/creatures/guppy_female.glb',
    credit: '“Guppy ♀” — Nestaeric (CC-BY 4.0)',
  },
  betta: {
    species: 'betta', axis: 'z', exclude: ['Cube_0'],
    url: 'models/creatures/betta.glb',
    credit: '“Betta Splendens” — BlueMesh (CC-BY 4.0)',
  },
  swordtail: {
    species: 'swordtail', axis: 'x', flip: true, exclude: ['Material.001'],
    url: 'models/creatures/swordtail.glb',
    credit: '“CC0 Green Swordtail, Xiphophorus helleri” — ffishAsia & floraZia (CC0)',
  },
  // Gerçek balık taramaları üzerine türün renk ve deseni giydirilir (overlay)
  danio: { species: 'danio', axis: 'x', flip: true, overlay: 1, url: 'models/creatures/medaka.glb', credit: '“CC0 Rice Fish (medaka)” — ffishAsia & floraZia (CC0), zebra danio deseniyle' },
  kuhli: { species: 'kuhli', axis: 'x', flip: true, overlay: 2, url: 'models/creatures/loach.glb', credit: '“CC0 Japanese Common Loach” — ffishAsia & floraZia (CC0), kuhli deseniyle' },
  barb: { species: 'barb', axis: 'x', flip: true, overlay: 3, url: 'models/creatures/medaka.glb', credit: '“CC0 Rice Fish (medaka)” — ffishAsia & floraZia (CC0), kiraz barbus deseniyle' },
  rasbora: { species: 'rasbora', axis: 'x', flip: true, overlay: 4, url: 'models/creatures/medaka.glb', credit: '“CC0 Rice Fish (medaka)” — ffishAsia & floraZia (CC0), harlequin deseniyle' },
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
    if (src.exclude?.includes(o.material?.name) || src.exclude?.includes(o.name)) return;
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
  return { parts, total, credit: src.credit, overlay: src.overlay ?? 0, mouth: findMouth(parts[0].geo, total) };
}

/** Ağız ucu: burnun en öndeki köşelerinin ortalaması (yerel koordinat) */
export function findMouth(geo, total) {
  const p = geo.attributes.position;
  let maxZ = -Infinity;
  for (let i = 0; i < p.count; i++) maxZ = Math.max(maxZ, p.getZ(i));
  let y = 0, n = 0;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > maxZ - total * 0.025) { y += p.getY(i); n++; }
  return new THREE.Vector3(0, n ? y / n : 0, maxZ);
}

const REAL_FRAG = /* glsl */ `
  {
    float u = vSeg.x / uBodyFrac;
    float v = vSeg.y;
    vec3 c = diffuseColor.rgb;
    float lum = dot(c, vec3(0.3, 0.59, 0.11));
    float body = smoothstep(0.08, 0.16, u) * smoothstep(1.02, 0.9, u);
    if (uOverlay > 0.5 && uOverlay < 1.5) {
      // zebra danio: altın gövde, yatay lacivert şeritler
      vec3 gold = lum * vec3(1.25, 1.1, 0.72) * 1.25;
      float st = 0.0;
      for (int k = 0; k < 4; k++) st = max(st, smoothstep(0.075, 0.035, abs(v - (-0.5 + float(k) * 0.3))));
      c = mix(gold, lum * vec3(0.25, 0.32, 0.9) * 1.6, st * body);
    } else if (uOverlay > 1.5 && uOverlay < 2.5) {
      // kuhli: somon turuncusu, sırttan inen koyu kuşaklar
      vec3 salmon = vec3(1.0, 0.56, 0.3) * (0.25 + lum * 1.6);
      float sad = smoothstep(0.1, 0.35, sin(u * 3.14159 * 13.0 + 0.6)) * smoothstep(-0.55, -0.2, v);
      c = mix(salmon, vec3(0.06, 0.04, 0.03), sad * body * 0.92);
      c = mix(c, lum * vec3(1.5, 1.25, 1.0), smoothstep(-0.55, -0.85, v) * 0.6);
    } else if (uOverlay > 2.5 && uOverlay < 3.5) {
      // kiraz barbus: kırmızı gövde, yan çizgide koyu şerit
      vec3 red = vec3(1.0, 0.2, 0.16) * (0.22 + lum * 1.5);
      float lat = smoothstep(0.08, 0.03, abs(v - 0.05)) * smoothstep(0.1, 0.2, u);
      c = mix(red, vec3(0.12, 0.04, 0.04), lat * body * 0.85);
    } else if (uOverlay > 3.5) {
      // harlequin rasbora: bakır-pembe gövde, arkada siyah üçgen
      vec3 copper = vec3(1.0, 0.52, 0.36) * (0.3 + lum * 1.55);
      float t = (u - 0.42) / 0.5;
      float tri = smoothstep(-0.05, 0.05, t) * smoothstep(1.05, 0.9, t) * smoothstep(0.42 * (1.0 - t) + 0.14, 0.42 * (1.0 - t) + 0.02, abs(v + 0.08 - t * 0.12));
      c = mix(copper, vec3(0.03, 0.02, 0.03), tri * 0.9);
    }
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
      uniforms: { ...fishUniforms, ...FISH_SHARED, uOverlay: { value: real.overlay } },
      extra: (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\n' + SWIM_VERT_DECL)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWIM_VERT);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\n' + PATTERN_DECL + '\nuniform float uOverlay;')
          .replace('#include <color_fragment>', '#include <color_fragment>\n' + REAL_FRAG + MOUTH_FRAG)
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
