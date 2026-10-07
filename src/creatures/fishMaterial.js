import * as THREE from 'three';
import { patchUnderwater } from '../render/water.js';

export const FISH_SHARED = {
  uNight: { value: 0 },
};

export const SWIM_VERT_DECL = /* glsl */ `
  attribute vec4 aSeg;
  uniform float uPhase;
  uniform float uAmp;
  uniform float uBend;
  uniform float uFlap;
  uniform float uLen;
  uniform float uMouth;
  uniform float uMouthY;
  uniform float uGill;
  uniform float uEel;
  varying vec4 vSeg;
  varying vec3 vObjPos;
`;

export const SWIM_VERT = /* glsl */ `
  vSeg = aSeg;
  vObjPos = transformed;
  {
    // Ağız: ön uçtaki köşeler dudak hattından yukarı/aşağı açılır, dudaklar öne uzar
    float km = smoothstep(0.075, 0.0, aSeg.x) * step(aSeg.z, 0.5);
    if (km > 0.0) {
      float dy = transformed.y - uMouthY;
      float gape = uMouth * km * uLen;
      transformed.y += dy > 0.0 ? gape * 0.034 : -gape * 0.055;
      transformed.z += gape * 0.012;
      transformed.x *= 1.0 + uMouth * km * 0.25;
    }
    // Solungaç kapakları: nefeste ve yutarken hafifçe açılır
    float kg = smoothstep(0.1, 0.17, aSeg.x) * smoothstep(0.27, 0.19, aSeg.x) * step(aSeg.z, 0.5);
    transformed.x *= 1.0 + uGill * kg * 0.09;
  }
  {
    float s = aSeg.x;
    // karangiform (çoğu balık): dalga arkada büyür; angiliform (kuhli): bütün gövde kıvrılır
    float env = mix(0.03 + s * s * 1.05, 0.3 + 0.7 * s, uEel);
    float wave = sin(uPhase - s * mix(5.2, 11.0, uEel));
    float lat = (uAmp * wave * env + uBend * s * s) * uLen;
    if (aSeg.z > 0.5 && aSeg.z < 1.5) {
      // yüzgeç zarının dalgalanması
      lat += sin(uPhase * 1.3 - s * 9.0 + aSeg.y * 2.0) * 0.06 * aSeg.w * uLen * (0.4 + uAmp * 4.0);
    }
    if (aSeg.z > 1.5) {
      // göğüs yüzgeçleri: kürek çekme
      float f = sin(uFlap + sign(aSeg.w) * 0.6);
      transformed.x += f * abs(aSeg.w) * 0.25 * uLen * 0.12 * sign(aSeg.w);
      transformed.y += f * abs(aSeg.w) * 0.18 * uLen * 0.1;
    }
    transformed.x += lat;
  }
`;

// Açık ağızdan görünen iç yüzey: karanlık ağız boşluğu
export const MOUTH_FRAG = /* glsl */ `
  if (!gl_FrontFacing && vSeg.x < 0.1) diffuseColor.rgb *= 0.12;
`;

export const PATTERN_DECL = /* glsl */ `
  uniform float uPattern;
  uniform float uSeed;
  uniform float uBodyFrac;
  uniform float uPale;
  uniform float uHighlight;
  uniform float uIch;
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform float uNight;
  varying vec4 vSeg;
  varying vec3 vObjPos;
  float fh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
  float fn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(fh(i), fh(i+vec2(1,0)), f.x), mix(fh(i+vec2(0,1)), fh(i+vec2(1,1)), f.x), f.y); }
  float band(float x, float c, float w, float soft) { return smoothstep(w + soft, w - soft, abs(x - c)); }
`;

const BODY_COLOR = /* glsl */ `
  float gGlow = 0.0;
  vec3 gGlowCol = vec3(0.0);
  {
    float u = vSeg.x / uBodyFrac;      // 0 burun .. 1 kuyruk sapı
    float v = vSeg.y;                  // -1 karın .. 1 sırt
    vec3 Vv = normalize(vViewPosition);
    float facing = abs(dot(normalize(vNormal), -Vv));
    vec3 c;
    if (uPattern < 0.5) {
      // NEON TETRA
      vec3 silver = vec3(0.46, 0.48, 0.46);
      vec3 back = vec3(0.2, 0.19, 0.12);
      c = mix(silver, back, smoothstep(0.3, 0.7, v));
      c = mix(c, vec3(0.75, 0.74, 0.7), smoothstep(-0.25, -0.65, v) * smoothstep(0.55, 0.35, u));
      float center = 0.24 - u * 0.1;
      float stripe = band(v, center, 0.15, 0.04) * smoothstep(0.05, 0.12, u) * smoothstep(0.95, 0.8, u);
      vec3 sA = vec3(0.0, 0.12, 0.9), sB = vec3(0.0, 0.6, 0.85);
      vec3 sc = mix(sA, sB, pow(1.0 - facing, 1.5) * 0.8 + 0.1 * sin(u * 12.0 + uSeed));
      float nightK = 1.0 - uNight * 0.75;
      c = mix(c, sc * nightK, stripe);
      gGlow = stripe * nightK * 2.0;
      gGlowCol = sc;
      float red = smoothstep(0.1, -0.02, v) * smoothstep(0.4, 0.5, u) * smoothstep(1.02, 0.92, u) * smoothstep(-0.98, -0.75, v);
      c = mix(c, vec3(0.8, 0.0, 0.03) * (1.0 - uNight * 0.5), red);
      gGlowCol = mix(gGlowCol, vec3(0.8, 0.0, 0.03), red);
      gGlow += red * 0.15 * (1.0 - uNight);
      // solungaç kapağı gümüş parıltı
      c += vec3(0.25) * band(u, 0.17, 0.035, 0.02) * smoothstep(0.6, 0.0, abs(v));
    } else if (uPattern < 1.5) {
      // LEPİSTES (erkek)
      vec3 base = vec3(0.36, 0.38, 0.3);
      c = mix(base, vec3(0.72, 0.7, 0.6), smoothstep(-0.2, -0.7, v));
      c = mix(c, vec3(0.2, 0.22, 0.16), smoothstep(0.3, 0.9, v));
      // pul dokusu
      c *= 0.9 + 0.1 * fn(vec2(u * 40.0, v * 12.0));
      // renkli lekeler ve siyah benek
      float blob = smoothstep(0.55, 0.75, fn(vec2(u * 6.0, v * 2.5) + uSeed));
      float region = smoothstep(0.35, 0.55, u);
      c = mix(c, uColA, blob * region * 0.9);
      float blob2 = smoothstep(0.6, 0.8, fn(vec2(u * 5.0 + 3.1, v * 3.0) - uSeed));
      c = mix(c, uColB, blob2 * region * 0.85);
      float spot = smoothstep(0.12, 0.05, length(vec2((u - 0.62) * 3.0, v - 0.1)));
      c = mix(c, vec3(0.02), spot);
      // pullarda yanardöner mavi-yeşil
      c += vec3(0.05, 0.25, 0.3) * pow(1.0 - facing, 2.0) * region;
      gGlow = blob * region * 0.25; gGlowCol = uColA;
    } else if (uPattern < 2.5) {
      // CORYDORAS AENEUS (bronz)
      vec3 base = vec3(0.62, 0.46, 0.36);
      c = base;
      c = mix(c, vec3(0.3, 0.22, 0.14), smoothstep(0.3, 0.85, v));
      float flank = smoothstep(-0.55, -0.2, v) * smoothstep(0.75, 0.35, v) * smoothstep(0.15, 0.3, u);
      vec3 metal = mix(vec3(0.1, 0.28, 0.2), vec3(0.4, 0.34, 0.12), pow(1.0 - facing, 1.2));
      c = mix(c, metal, flank * 0.85);
      // kemik plaka çizgileri
      c *= 1.0 - 0.15 * band(fract(u * 14.0), 0.5, 0.06, 0.04) * flank;
      c = mix(c, vec3(0.78, 0.62, 0.5), smoothstep(-0.55, -0.85, v));
      c += vec3(0.2, 0.15, 0.05) * band(u, 0.15, 0.06, 0.03);
    } else if (uPattern < 3.5) {
      // ZEBRA DANIO: altın zemin üzerinde boylu boyunca lacivert şeritler
      c = mix(vec3(0.78, 0.7, 0.48), vec3(0.42, 0.4, 0.3), smoothstep(0.4, 0.9, v));
      c = mix(c, vec3(0.88, 0.86, 0.8), smoothstep(-0.5, -0.85, v));
      float st = smoothstep(0.25, 0.55, sin((v + 0.08) * 3.14159 * 4.6)) * smoothstep(-0.75, -0.45, v) * smoothstep(0.6, 0.35, v) * smoothstep(0.12, 0.25, u);
      vec3 blue = mix(vec3(0.05, 0.1, 0.42), vec3(0.15, 0.3, 0.7), pow(1.0 - facing, 1.5));
      c = mix(c, blue, st);
      gGlow = st * 0.25; gGlowCol = blue;
    } else if (uPattern < 4.5) {
      // BETA: koyu ve doygun gövde, pullarda yanardöner parıltı
      c = uColA * (0.75 + 0.25 * fn(vec2(u * 30.0, v * 10.0)));
      c = mix(c, uColA * 0.55, smoothstep(0.3, 0.9, v));
      c += uColB * 0.25 * pow(1.0 - facing, 2.0) * smoothstep(0.1, 0.3, u);
      gGlow = 0.15; gGlowCol = uColA;
    } else if (uPattern < 5.5) {
      // MELEK BALIĞI: gümüş zemin, siyah dikey bantlar
      c = mix(vec3(0.84, 0.84, 0.8), vec3(0.6, 0.55, 0.38), smoothstep(0.55, 0.95, v) * smoothstep(0.4, 0.1, u));
      float bars = band(u, 0.13, 0.035, 0.02) + band(u, 0.42, 0.06, 0.03) + band(u, 0.74, 0.045, 0.025) * 0.8 + band(u, 0.97, 0.03, 0.02) * 0.6;
      c = mix(c, vec3(0.06, 0.06, 0.07), clamp(bars, 0.0, 1.0) * 0.9);
      c += vec3(0.1, 0.12, 0.14) * pow(1.0 - facing, 2.0);
    } else if (uPattern < 6.5) {
      // PLATİ / KILIÇKUYRUK: doygun gövde, kuyruk sapında koyu leke
      c = uColA;
      c = mix(c, uColA * 0.55, smoothstep(0.35, 0.9, v));
      c = mix(c, mix(uColA, vec3(1.0, 0.9, 0.7), 0.4), smoothstep(-0.4, -0.85, v));
      c = mix(c, uColB, smoothstep(0.85, 0.95, u) * smoothstep(0.7, 0.2, abs(v)) * 0.85);
      c = mix(c, uColB, band(v, 0.0, 0.05, 0.04) * smoothstep(0.2, 0.4, u) * 0.3);
      c *= 0.9 + 0.1 * fn(vec2(u * 40.0, v * 12.0));
      gGlow = 0.12; gGlowCol = uColA;
    } else if (uPattern < 7.5) {
      // SİYAH MOLİ: kadife siyah, hafif gümüşi pul parıltısı
      c = vec3(0.025) * (0.8 + 0.4 * fn(vec2(u * 40.0, v * 12.0)));
      c += vec3(0.05, 0.06, 0.07) * pow(1.0 - facing, 2.5);
    } else if (uPattern < 8.5) {
      // KARDİNAL TETRA: neon şerit + tüm karın kırmızı
      c = mix(vec3(0.46, 0.48, 0.46), vec3(0.2, 0.19, 0.12), smoothstep(0.3, 0.7, v));
      float stripe = band(v, 0.24 - u * 0.1, 0.15, 0.04) * smoothstep(0.05, 0.12, u) * smoothstep(0.95, 0.8, u);
      vec3 sc = mix(vec3(0.0, 0.15, 0.95), vec3(0.0, 0.65, 0.9), pow(1.0 - facing, 1.5) * 0.8);
      float nightK = 1.0 - uNight * 0.75;
      c = mix(c, sc * nightK, stripe);
      float red = smoothstep(0.1, -0.02, v) * smoothstep(0.08, 0.16, u) * smoothstep(1.02, 0.92, u);
      c = mix(c, vec3(0.82, 0.02, 0.04) * (1.0 - uNight * 0.5), red);
      gGlow = stripe * nightK * 2.0 + red * 0.15; gGlowCol = mix(sc, vec3(0.8, 0.0, 0.03), red);
    } else if (uPattern < 9.5) {
      // HARLEQUIN RASBORA: bakır-pembe gövde, siyah üçgen
      c = mix(vec3(0.88, 0.56, 0.42), vec3(0.55, 0.42, 0.3), smoothstep(0.3, 0.8, v));
      c = mix(c, vec3(0.95, 0.85, 0.75), smoothstep(-0.4, -0.8, v));
      float tri = step(0.45, u) * step(u, 0.97) * step(-0.55 + (u - 0.45) * 1.0, v) * step(v, 0.4 - (u - 0.45) * 0.75);
      c = mix(c, vec3(0.03, 0.02, 0.03), tri * 0.95);
      c += vec3(0.1, 0.06, 0.08) * pow(1.0 - facing, 2.0);
    } else if (uPattern < 10.5) {
      // KİRAZ BARBUS
      c = mix(vec3(0.8, 0.12, 0.12), vec3(0.45, 0.12, 0.08), smoothstep(0.3, 0.85, v));
      c = mix(c, vec3(0.9, 0.45, 0.35), smoothstep(-0.4, -0.85, v));
      c = mix(c, vec3(0.25, 0.05, 0.04), band(v, 0.05, 0.06, 0.04) * smoothstep(0.15, 0.3, u) * 0.6);
      gGlow = 0.12; gGlowCol = vec3(0.8, 0.1, 0.1);
    } else if (uPattern < 11.5) {
      // CÜCE GURAMİ: çapraz kırmızı-mavi bantlar
      float st = smoothstep(-0.2, 0.2, sin(u * 22.0 + v * 4.0));
      c = mix(vec3(0.85, 0.22, 0.1), vec3(0.15, 0.4, 0.95), st);
      c = mix(c, vec3(0.2, 0.45, 0.95), smoothstep(-0.5, -0.9, v) * 0.6);
      gGlow = 0.2 * st; gGlowCol = vec3(0.2, 0.5, 1.0);
    } else if (uPattern < 12.5) {
      // KUHLİ: somon zemin üzerinde koyu halkalar
      c = mix(vec3(0.95, 0.62, 0.38), vec3(1.0, 0.85, 0.7), smoothstep(-0.3, -0.85, v));
      float ring = smoothstep(0.4, 0.55, fract(u * 11.0 + 0.2)) * smoothstep(-0.55, -0.2, v) * step(0.06, u);
      c = mix(c, vec3(0.08, 0.05, 0.04), ring * 0.95);
    } else {
      // OTOCİNCLUS: kum rengi, koyu yan çizgi, beyaz karın
      c = mix(vec3(0.6, 0.52, 0.38), vec3(0.38, 0.32, 0.22), smoothstep(0.3, 0.85, v));
      c *= 0.85 + 0.25 * fn(vec2(u * 30.0, v * 9.0));
      c = mix(c, vec3(0.12, 0.1, 0.07), band(v, 0.0, 0.12, 0.05) * smoothstep(0.08, 0.2, u));
      c = mix(c, vec3(0.88, 0.85, 0.78), smoothstep(-0.4, -0.8, v));
    }
    // beyaz benek hastalığı
    float ich = smoothstep(0.8, 0.88, fn(vec2(u * 60.0, v * 18.0) + uSeed * 3.0)) * uIch;
    c = mix(c, vec3(0.95, 0.95, 0.92), ich);
    // sağlık/stres: soluk ve gri
    float g = dot(c, vec3(0.3, 0.59, 0.11));
    c = mix(c, vec3(g) * 0.9, uPale * 0.75);
    c = mix(c, c * 0.8 + vec3(0.03, 0.04, 0.05), uNight * 0.3);
    diffuseColor.rgb = c;
  }
`;

const FIN_COLOR = /* glsl */ `
  {
    float s = vSeg.x;
    float w = abs(vSeg.w);
    float isTail = step(0.999, s / uBodyFrac);
    float rays = isTail > 0.5 ? 0.82 + 0.18 * sin(vUv.y * 48.0) : 0.85 + 0.15 * sin(vUv.x * 34.0);
    vec3 c;
    float a;
    if (uPattern < 0.5) {
      c = vec3(0.85, 0.85, 0.82);
      a = 0.16 + 0.12 * w;
      // anal yüzgecin beyaz ön kenarı
      if (vSeg.y < -0.5) { c = vec3(0.95); a += 0.25 * smoothstep(0.25, 0.0, vUv.x); }
      if (isTail > 0.5) { c = mix(c, vec3(0.75, 0.15, 0.1), 0.25 * (1.0 - w)); }
    } else if (uPattern < 1.5) {
      c = mix(uColA, uColB, smoothstep(0.1, 0.9, w + fn(vUv * 5.0) * 0.3));
      float dots = smoothstep(0.66, 0.74, fn(vUv * vec2(9.0, 7.0) + 3.7));
      c = mix(c, vec3(0.05, 0.03, 0.06), dots * 0.7 * isTail);
      c = mix(c, uColB * 1.2, smoothstep(0.85, 1.0, w) * 0.6);
      a = 0.55 + 0.3 * w;
      if (vSeg.z > 1.5) { c = vec3(0.8); a = 0.15; }
    } else if (uPattern < 2.5) {
      c = vec3(0.78, 0.72, 0.62);
      float pep = smoothstep(0.65, 0.75, fn(vUv * vec2(14.0, 10.0)));
      c = mix(c, vec3(0.15, 0.12, 0.1), pep * 0.8);
      a = 0.3 + pep * 0.3;
    } else if (uPattern < 3.5) {
      c = vec3(0.85, 0.82, 0.7);
      float st = smoothstep(0.2, 0.6, sin(vUv.y * 22.0)) * (isTail > 0.5 || vSeg.y < -0.5 ? 1.0 : 0.0);
      c = mix(c, vec3(0.1, 0.16, 0.45), st);
      a = 0.22 + st * 0.4;
    } else if (uPattern < 4.5) {
      // peçe yüzgeçler: gövde rengi, uçlara doğru ikinci renk, yarı saydam kenar
      c = mix(uColA * 0.9, uColB, smoothstep(0.55, 1.0, w) * 0.7);
      rays = 0.9 + 0.1 * (rays - 0.82) / 0.18;
      a = 0.9 - smoothstep(0.88, 1.0, w) * 0.3;
      if (vSeg.z > 1.5) { c = uColA; a = 0.4; }
    } else if (uPattern < 5.5) {
      c = vec3(0.8, 0.8, 0.78);
      float bar = band(vUv.x, 0.5, 0.12, 0.08) * (vSeg.y != 0.0 ? 1.0 : 0.0);
      c = mix(c, vec3(0.08), bar * 0.8);
      a = 0.25 + bar * 0.35;
      if (vSeg.z > 1.5) { a = 0.35; c = vec3(0.85); }
    } else if (uPattern < 6.5) {
      c = mix(uColA, uColB, smoothstep(0.6, 1.0, w) * isTail * 0.6);
      a = 0.55 + 0.2 * w;
    } else if (uPattern < 7.5) {
      c = vec3(0.03); a = 0.8;
    } else if (uPattern < 8.5) {
      c = vec3(0.85, 0.85, 0.82); a = 0.18 + 0.12 * w;
    } else if (uPattern < 9.5) {
      c = vec3(0.95, 0.6, 0.45); a = 0.3;
    } else if (uPattern < 10.5) {
      c = vec3(0.85, 0.2, 0.18); a = 0.45;
    } else if (uPattern < 11.5) {
      float st = smoothstep(-0.2, 0.2, sin(vUv.x * 20.0 + vUv.y * 6.0));
      c = mix(vec3(0.85, 0.25, 0.1), vec3(0.2, 0.45, 0.95), st);
      c = mix(c, vec3(0.9, 0.3, 0.12), smoothstep(0.8, 1.0, w));
      a = 0.6;
      if (vSeg.z > 1.5) { c = vec3(0.95, 0.75, 0.55); a = 0.7; }
    } else {
      c = vec3(0.8, 0.75, 0.65);
      float pep = smoothstep(0.65, 0.75, fn(vUv * vec2(12.0, 9.0)));
      c = mix(c, vec3(0.15, 0.12, 0.1), pep * 0.6);
      a = 0.25 + pep * 0.25;
    }
    c *= rays;
    float edge = 1.0 - smoothstep(0.85, 1.0, w) * 0.4;
    float g = dot(c, vec3(0.3, 0.59, 0.11));
    c = mix(c, vec3(g), uPale * 0.6);
    diffuseColor.rgb = c;
    diffuseColor.a = clamp(a * rays * edge, 0.0, 1.0) * (1.0 - uPale * 0.3);
  }
`;

export function makeFishMaterials(fishUniforms) {
  const body = new THREE.MeshPhysicalMaterial({
    roughness: 0.42,
    metalness: 0.05,
    clearcoat: 0.25,
    clearcoatRoughness: 0.35,
    iridescence: fishUniforms.uPattern.value < 0.5 ? 0.35 : 0.2,
    iridescenceIOR: 1.5,
    iridescenceThicknessRange: [250, 650],
    side: THREE.DoubleSide,
  });
  patchUnderwater(body, {
    key: 'fish-body',
    uniforms: { ...fishUniforms, ...FISH_SHARED },
    extra: (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + SWIM_VERT_DECL)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWIM_VERT);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + PATTERN_DECL)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + BODY_COLOR + MOUTH_FRAG)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += gGlowCol * gGlow * 0.3 * (0.4 + uLamp);
          totalEmissiveRadiance += vec3(0.25, 0.6, 1.0) * uHighlight * 0.12;`);
    },
  });

  const fins = new THREE.MeshStandardMaterial({
    roughness: 0.4,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  patchUnderwater(fins, {
    key: 'fish-fin',
    uniforms: { ...fishUniforms, ...FISH_SHARED },
    extra: (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + SWIM_VERT_DECL + '\nvarying vec2 vUv2;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWIM_VERT + '\nvUv2 = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + PATTERN_DECL + '\nvarying vec2 vUv2;\n#define vUv vUv2')
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + FIN_COLOR);
    },
  });
  return { body, fins };
}

export function makeFishUniforms(len, pattern, bodyFrac, colA, colB, seed) {
  return {
    uPhase: { value: Math.random() * 10 },
    uAmp: { value: 0.08 },
    uBend: { value: 0 },
    uFlap: { value: 0 },
    uLen: { value: len },
    uMouth: { value: 0 },
    uMouthY: { value: 0 },
    uGill: { value: 0 },
    uEel: { value: 0 },
    uPattern: { value: pattern },
    uSeed: { value: seed },
    uBodyFrac: { value: bodyFrac },
    uPale: { value: 0 },
    uHighlight: { value: 0 },
    uIch: { value: 0 },
    uColA: { value: new THREE.Color(colA) },
    uColB: { value: new THREE.Color(colB) },
  };
}
