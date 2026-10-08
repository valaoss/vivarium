import * as THREE from 'three';

// Teraryum tabanı: üç gerçek ölçekli Poly Haven (CC0) taraması, yükseklik haritasıyla karışır.
// Yaprak döküntüsü toprağın tümseklerinin üstüne biner, kıyıda ıslak çakıllı çamur çıkar.
// Aynı yükseklik haritası zemin ağını gerçekten kabartır (fizik zemini de bundan okunur).
const BASE = `${import.meta.env.BASE_URL}textures/substrate/`;
// size: dokunun kapladığı cm, amp: kabartma cm, off: uv kaydırma
export const LAYERS = [
  { name: 'mud_forest', size: 48, amp: 0.65, off: [0.13, 0.71] },
  { name: 'dry_decay_leaves', size: 65, amp: 0.65, off: [0.42, 0.27] },
  { name: 'brown_mud_rocks_01', size: 38, amp: 0.5, off: [0.77, 0.55] },
];
const K = 0.7, SHARP = 0.2;

async function heightData(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Substrate height map: ${response.status} ${url}`);
  const bmp = await createImageBitmap(await response.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const px = g.getImageData(0, 0, c.width, c.height).data;
  const H = new Uint8Array(c.width * c.height);
  for (let i = 0; i < H.length; i++) H[i] = px[i * 4];
  return { H, n: c.width };
}

export async function loadSubstrate(renderer) {
  const tl = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (url, srgb) => tl.loadAsync(url).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  return Promise.all(LAYERS.map(async (L) => {
    const u = (m) => `${BASE}${L.name}_${m}.jpg`;
    const [diff, nor, drh, disp] = await Promise.all([tex(u('diff'), true), tex(u('nor')), tex(u('drh')), heightData(u('drh'))]);
    return { ...L, diff, nor, drh, disp };
  }));
}

// görüntü satırı: doku flipY ile yüklenir, v=0 resmin altı
function sampleDisp(L, x, z) {
  const { H, n } = L.disp;
  let u = x / L.size + L.off[0], v = -z / L.size + L.off[1];
  u = (u - Math.floor(u)) * n - 0.5; v = (1 - (v - Math.floor(v))) * n - 0.5;
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const at = (a, b) => H[(((b % n) + n) % n) * n + (((a % n) + n) % n)];
  return ((at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv) / 255;
}

function heightBlend(w, d, out) {
  let m = -1e9;
  for (let i = 0; i < 3; i++) { out[i] = w[i] + K * d[i]; m = Math.max(m, out[i]); }
  m -= SHARP;
  let s = 0;
  for (let i = 0; i < 3; i++) { out[i] = Math.max(out[i] - m, 0); s += out[i]; }
  for (let i = 0; i < 3; i++) out[i] /= s;
  return out;
}

// weights(x, z, h, out): katman ağırlıkları [toprak, yaprak, kıyı]; h kabartmasız taban yüksekliği
export function makeRelief(layers, weights) {
  const w = [0, 0, 0], d = [0, 0, 0], b = [0, 0, 0];
  return (x, z, h) => {
    weights(x, z, h, w);
    for (let i = 0; i < 3; i++) d[i] = sampleDisp(layers[i], x, z);
    heightBlend(w, d, b);
    let r = 0;
    for (let i = 0; i < 3; i++) r += b[i] * (d[i] - 0.5) * layers[i].amp;
    return r;
  };
}

export function substrateMaterial(layers, waterY) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const f = (v) => v.toFixed(4);
  m.onBeforeCompile = (sh) => {
    layers.forEach((L, i) => {
      sh.uniforms[`sD${i}`] = { value: L.diff };
      sh.uniforms[`sN${i}`] = { value: L.nor };
      sh.uniforms[`sH${i}`] = { value: L.drh };
    });
    sh.uniforms.uWater = { value: waterY };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aW;\nvarying vec3 vW, vWp, vWn;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vW = aW; vWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vWn = normalize(mat3(modelMatrix) * objectNormal);`);
    const uv = layers.map((L, i) => `vec2 u${i} = vec2(vWp.x, -vWp.z) / ${f(L.size)} + vec2(${f(L.off[0])}, ${f(L.off[1])});`).join('\n');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D sD0, sD1, sD2, sN0, sN1, sN2, sH0, sH1, sH2;
        uniform float uWater;
        varying vec3 vW, vWp, vWn;`)
      .replace('#include <map_fragment>', `
        ${uv}
        vec3 h0 = texture2D(sH0, u0).rgb, h1 = texture2D(sH1, u1).rgb, h2 = texture2D(sH2, u2).rgb;
        vec3 ba = vW + ${f(K)} * vec3(h0.r, h1.r, h2.r);
        vec3 bw = max(ba - (max(max(ba.x, ba.y), ba.z) - ${f(SHARP)}), 0.0);
        bw /= bw.x + bw.y + bw.z;
        vec3 alb = texture2D(sD0, u0).rgb * bw.x + texture2D(sD1, u1).rgb * bw.y + texture2D(sD2, u2).rgb * bw.z;
        vec3 nT = (texture2D(sN0, u0).xyz * 2.0 - 1.0) * bw.x + (texture2D(sN1, u1).xyz * 2.0 - 1.0) * bw.y + (texture2D(sN2, u2).xyz * 2.0 - 1.0) * bw.z;
        vec3 hb = h0 * bw.x + h1 * bw.y + h2 * bw.z;
        // ıslaklık: su kıyısında ve çukurlarda koyu ve parlak
        float wet = 1.0 - smoothstep(uWater - 0.2, uWater + 0.8 + (1.0 - hb.r) * 0.5, vWp.y);
        alb *= mix(1.0, 0.62, wet) * mix(1.0, hb.b, 0.55);
        float sRough = mix(max(hb.g, 0.72), 0.38, wet * 0.8);
        diffuseColor.rgb *= alb;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = sRough;')
      .replace('#include <normal_fragment_maps>', `{
        vec3 Ng = normalize(vWn);
        vec3 T = normalize(vec3(1.0, 0.0, 0.0) - Ng * Ng.x);
        vec3 B = cross(Ng, T);
        vec3 nW = normalize(T * nT.x * 0.7 + B * nT.y * 0.7 + Ng * max(nT.z, 0.35));
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      }`);
  };
  m.customProgramCacheKey = () => 'substrate';
  return m;
}

// Temas gölgesi: her köşe çevresindeki yüksek nesnelerin (yosun, tüp, yaprak, bitki) ufuk açısına göre koyulaşır.
// field: engelleri de içeren yükseklik haritası; yerel eğim düzlemi çıkarılır (düz yokuş kararmaz).
export function contactAO(geo, field, strength = 0.6) {
  const p = geo.attributes.position, nrm = geo.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const R = [0.4, 1, 2.2, 4.5], N = 10;
  const dirs = Array.from({ length: N }, (_, k) => [Math.cos(k / N * 6.283), Math.sin(k / N * 6.283)]);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ny = Math.max(0.3, nrm.getY(i)), sx = nrm.getX(i) / ny, sz = nrm.getZ(i) / ny;
    let occ = 0;
    for (const [c, s] of dirs) {
      let best = 0;
      for (const r of R) {
        const dh = field.at(x + c * r, z + s * r) - y + r * (sx * c + sz * s);
        best = Math.max(best, dh / Math.hypot(dh, r));
      }
      occ += best;
    }
    const v = 1 - strength * Math.pow(occ / N, 0.8);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
