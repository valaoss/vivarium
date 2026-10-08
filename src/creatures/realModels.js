import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { patchUnderwater } from '../render/water.js';
import { SWIM_VERT_DECL, SWIM_VERT, SWIM_NORMAL, PATTERN_DECL, FISH_SHARED, MOUTH_FRAG } from './fishMaterial.js';
import { SPECIES } from './species.js';
import { physicalMaterial } from '../render/materials.js';

/*
 * Gerçek balık modelleri (Sketchfab, CC-BY). İskeletli modeller bind pozunda
 * düz geometriye çevrilir, burun +Z, sırt +Y olacak şekilde hizalanır ve
 * prosedürel balıklarla aynı yüzme shader'ı (aSeg) uygulanır. Böylece davranış,
 * dönüş kıvrımı ve hız animasyonu aynen çalışır.
 */
export const REAL_FISH = {};
if (typeof window !== "undefined") window.__REAL_FISH = REAL_FISH;

// axis: modelin boy ekseni ('x' | 'y' | 'z'); flip: burun eksi yöndeyse
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
  angel: {
    species: 'angel', axis: 'y', overlay: 5,
    url: 'models/creatures/angelfish.glb',
    credit: '“Freshwater Angelfish” — Wataru Onuki / monte-hotate (Sketchfab Standard), gümüş-çizgili desenle',
  },
  cardinal: { species: 'cardinal', axis: 'z', overlay: 6, url: 'models/fish/neon/scene.gltf', credit: '“Paracheirodon Innesi _ Tetra Neon” — BlueMesh (CC-BY 4.0), kardinal deseniyle' },
  molly: { species: 'molly', axis: 'x', flip: true, overlay: 7, ys: 1.12, url: 'models/creatures/mosquitofish.glb', credit: '“CC0 Mosquitofish, Gambusia affinis” — ffishAsia & floraZia (CC0), siyah moli rengiyle' },
  platy: { species: 'platy', axis: 'x', flip: true, overlay: 8, ys: 1.3, url: 'models/creatures/mosquitofish.glb', credit: '“CC0 Mosquitofish, Gambusia affinis” — ffishAsia & floraZia (CC0), plati rengiyle' },
  gourami: { species: 'gourami', axis: 'x', flip: true, overlay: 9, ys: 1.45, url: 'models/creatures/paradisefish.glb', credit: '“CC0 Paradise Fish, Macropodus opercularis” — ffishAsia & floraZia (CC0), cüce gurami deseniyle' },
  oto: { species: 'oto', axis: 'x', flip: true, overlay: 10, ys: 0.85, url: 'models/creatures/pleco.glb', credit: '“Hypostomus / Coroncoro” — alzarac (CC-BY 4.0), otocinclus deseniyle' },
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
    if (src.axis === 'y') g.rotateX(Math.PI / 2);
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
    p.geo.scale(scale, scale * (src.ys ?? 1), scale);
    p.geo.computeBoundingBox();
  }
  const half = (size.z * scale) / 2;
  const halfH = (size.y * scale * (src.ys ?? 1)) / 2;
  for (const p of parts) {
    const pos = p.geo.attributes.position;
    const seg = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      seg[i * 4] = (half - pos.getZ(i)) / (2 * half);   // 0 burun .. 1 kuyruk ucu
      seg[i * 4 + 1] = pos.getY(i) / halfH;
      const along = seg[i * 4], x = pos.getX(i), y = pos.getY(i);
      const tail = THREE.MathUtils.smoothstep(along, b.length / total * 0.94, 1);
      const vertical = THREE.MathUtils.smoothstep(Math.abs(y), b.height * 0.48, b.height * 0.9);
      const lateral = THREE.MathUtils.smoothstep(Math.abs(x), b.width * 0.55, b.width * 1.1);
      // Zero weight at the attachment avoids a seam between body and fin.
      if (along > 0.15 && along < 0.43 && lateral > 0) {
        seg[i * 4 + 2] = 2;
        seg[i * 4 + 3] = Math.sign(x) * lateral;
      } else if (along > 0.15 && (tail > 0 || vertical > 0)) {
        seg[i * 4 + 2] = 1;
        seg[i * 4 + 3] = Math.max(tail, vertical);
      }
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
      vec3 gold = lum * vec3(1.45, 1.08, 0.42) * 1.35;
      float st = 0.0;
      for (int k = 0; k < 4; k++) st = max(st, smoothstep(0.075, 0.035, abs(v - (-0.5 + float(k) * 0.3))));
      c = mix(gold, lum * vec3(0.25, 0.32, 0.9) * 1.6, st * body);
    } else if (uOverlay > 1.5 && uOverlay < 2.5) {
      // kuhli: somon turuncusu, sırttan inen koyu kuşaklar
      vec3 salmon = vec3(1.0, 0.4, 0.1) * (0.3 + lum * 1.9);
      float ph = (fn(vec2(u * 7.0, 1.3)) - 0.5) * 2.2;
      float sad = smoothstep(-0.15, 0.25, sin(u * 3.14159 * 25.0 + ph)) * smoothstep(-0.6 + ph * 0.12, -0.25, v);
      c = mix(salmon, vec3(0.06, 0.04, 0.03), sad * body * 0.92);
      c = mix(c, lum * vec3(1.5, 1.25, 1.0), smoothstep(-0.55, -0.85, v) * 0.6);
    } else if (uOverlay > 2.5 && uOverlay < 3.5) {
      // kiraz barbus: kırmızı gövde, yan çizgide koyu şerit
      vec3 red = vec3(0.85, 0.06, 0.04) * (0.3 + lum * 2.0);
      float lat = smoothstep(0.08, 0.03, abs(v - 0.05)) * smoothstep(0.1, 0.2, u);
      c = mix(red, vec3(0.12, 0.04, 0.04), lat * body * 0.85);
    } else if (uOverlay > 9.5) {
      // otocinclus: alaca kahve sırt, burundan kuyruğa siyah şerit, beyaz karın
      float mott = fn(vec2(u * 26.0, v * 9.0));
      vec3 back = mix(vec3(0.2, 0.11, 0.03), vec3(0.36, 0.22, 0.07), mott) * (0.45 + lum * 1.1);
      c = mix(back, vec3(0.62, 0.6, 0.52) * (0.5 + lum * 0.8), smoothstep(-0.15, -0.45, v));
      float line = smoothstep(0.13, 0.07, abs(v + 0.08 - u * 0.06)) * smoothstep(0.02, 0.06, u) * smoothstep(1.0, 0.85, u);
      c = mix(c, vec3(0.012, 0.01, 0.008), line * 0.92);
      c = mix(c, vec3(0.05), smoothstep(0.08, 0.03, length(vec2(vSeg.x - uBodyFrac - 0.03, v * 0.35))) * 0.8);
    } else if (uOverlay > 8.5) {
      // cüce gurami: kırmızı-turuncu gövde, eğik turkuaz çizgiler, mavi gırtlak
      vec3 red = vec3(0.9, 0.17, 0.05) * (0.35 + lum * 2.2);
      float wob = fn(vec2(u * 9.0, v * 5.0)) - 0.5;
      float st = smoothstep(0.55, 0.85, sin((u - v * 0.09 + wob * 0.05) * 3.14159 * 24.0));
      st *= smoothstep(0.2, 0.6, fn(vec2(u * 30.0, v * 4.0))) * 0.5 + 0.5;
      c = mix(red, vec3(0.1, 0.42, 0.85) * (0.35 + lum * 1.8), st * body * 0.85);
      c = mix(c, vec3(0.35, 0.55, 0.95) * (0.35 + lum * 1.2), smoothstep(0.32, 0.12, u) * smoothstep(-0.05, -0.45, v) * 0.85);
      float dots = smoothstep(0.62, 0.72, fn(vec2(u * 40.0, v * 12.0))) * step(0.9, u + abs(v) * 0.3);
      c = mix(c, vec3(0.85, 0.15, 0.1) * (0.4 + lum), dots * 0.6);
    } else if (uOverlay > 7.5) {
      // plati: türün rengi gövdede, ikinci renk kuyruk ve yüzgeçlerde
      vec3 base = uColA * (0.25 + lum * 1.5);
      c = mix(base, base * 1.15 + 0.05, smoothstep(-0.2, -0.7, v) * 0.5);
      float fin = max(smoothstep(0.86, 0.95, u), smoothstep(0.62, 0.85, abs(v)) * step(0.3, u));
      c = mix(c, uColB * (0.3 + lum * 1.4), fin * 0.75);
    } else if (uOverlay > 6.5) {
      // siyah moli: kadifemsi siyah, hafif zeytin yansıma
      c = vec3(0.025, 0.026, 0.024) + lum * vec3(0.1, 0.1, 0.085);
    } else if (uOverlay > 5.5) {
      // kardinal tetra: kırmızı, mavi şeridin altında burundan kuyruğa kadar
      float blue = smoothstep(0.04, 0.16, c.b - max(c.r, c.g));
      float below = smoothstep(0.12, -0.02, v) * smoothstep(0.05, 0.12, u) * smoothstep(1.0, 0.92, u);
      c = mix(c, vec3(0.9, 0.08, 0.1) * (0.3 + lum * 1.3), below * (1.0 - blue) * 0.95);
    } else if (uOverlay > 4.5) {
      // yabani melek: gümüş gövde, göz-gövde-kuyruk sapı boyunca siyah dikey kuşaklar
      float uu = vSeg.x;
      vec3 silver = vec3(0.8, 0.81, 0.78) * (0.3 + lum * 0.95);
      float bar = 0.0;
      bar = max(bar, smoothstep(0.03, 0.012, abs(uu - 0.155 - v * 0.02)));
      bar = max(bar, smoothstep(0.05, 0.025, abs(uu - 0.37 + v * 0.03)) * 0.95);
      bar = max(bar, smoothstep(0.022, 0.008, abs(uu - 0.53)) * 0.45);
      bar = max(bar, smoothstep(0.045, 0.02, abs(uu - 0.66 + v * 0.05)) * 0.9);
      c = mix(silver, vec3(0.05, 0.05, 0.055), bar * 0.9);
      c = mix(c, vec3(0.62, 0.45, 0.32) * (0.4 + lum), smoothstep(0.15, 0.03, uu) * smoothstep(0.1, 0.5, v) * 0.35);
    } else if (uOverlay > 3.5) {
      // harlequin rasbora: bakır-pembe gövde, arkada siyah üçgen
      vec3 copper = vec3(0.9, 0.34, 0.15) * (0.35 + lum * 1.8);
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
    const m = physicalMaterial(p.material, {
      roughness: 0.48, metalness: 0, clearcoat: 0.22,
      clearcoatRoughness: 0.3, ior: 1.38,
    });
    // taramalarda metal haritası pulları krom gibi gösterir
    m.metalnessMap = null;
    m.side = THREE.DoubleSide;
    m.transparent = p.material.transparent;
    m.depthWrite = true;
    m.alphaTest = 0.04;
    patchUnderwater(m, {
      key: 'real-fish',
      uniforms: { ...fishUniforms, ...FISH_SHARED, uOverlay: { value: real.overlay } },
      extra: (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\n' + SWIM_VERT_DECL)
          .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + SWIM_NORMAL)
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
    mesh.receiveShadow = true;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: m.map, alphaMap: m.alphaMap, alphaTest: m.alphaTest, side: m.side });
    depth.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, fishUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + SWIM_VERT_DECL)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWIM_VERT);
    };
    depth.customProgramCacheKey = () => 'fish-swim-depth';
    mesh.customDepthMaterial = depth;
    mesh.renderOrder = 7;
    return mesh;
  });
}

export function realCredits() {
  return Object.values(REAL_FISH).map((r) => r.credit);
}
