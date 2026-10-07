import * as THREE from 'three';
import { patchUnderwater } from '../render/water.js';

export const FISH_SHARED = {
  uNight: { value: 0 },
};

const SWIM_VERT_DECL = /* glsl */ `
  attribute vec4 aSeg;
  uniform float uPhase;
  uniform float uAmp;
  uniform float uBend;
  uniform float uFlap;
  uniform float uLen;
  varying vec4 vSeg;
  varying vec3 vObjPos;
`;

const SWIM_VERT = /* glsl */ `
  vSeg = aSeg;
  vObjPos = transformed;
  {
    float s = aSeg.x;
    float env = 0.03 + s * s * 1.05;
    float wave = sin(uPhase - s * 5.2);
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

const PATTERN_DECL = /* glsl */ `
  uniform float uPattern;
  uniform float uSeed;
  uniform float uBodyFrac;
  uniform float uPale;
  uniform float uHighlight;
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
    } else {
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
    }
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
    } else {
      c = vec3(0.78, 0.72, 0.62);
      float pep = smoothstep(0.65, 0.75, fn(vUv * vec2(14.0, 10.0)));
      c = mix(c, vec3(0.15, 0.12, 0.1), pep * 0.8);
      a = 0.3 + pep * 0.3;
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
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + BODY_COLOR)
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
    uPattern: { value: pattern },
    uSeed: { value: seed },
    uBodyFrac: { value: bodyFrac },
    uPale: { value: 0 },
    uHighlight: { value: 0 },
    uColA: { value: new THREE.Color(colA) },
    uColB: { value: new THREE.Color(colB) },
  };
}
