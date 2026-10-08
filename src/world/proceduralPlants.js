import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchUnderwater } from '../render/water.js';
import { mulberry } from '../render/textures.js';

// Prosedürel bitkiler (yerel birim: cm). Her köşe aSway taşır: x = salınım ağırlığı, y = yükseklik oranı (renk/sağlık için)
function tag(geo, sway, h, color) {
  const n = geo.attributes.position.count;
  const s = new Float32Array(n * 2), c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    s[i * 2] = typeof sway === 'function' ? sway(geo.attributes.position, i) : sway;
    s[i * 2 + 1] = h;
    c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b;
  }
  geo.setAttribute('aSway', new THREE.BufferAttribute(s, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo.index ? geo.toNonIndexed() : geo;
}

function procShader(mode) {
  return (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uPhase;
        attribute vec2 aSway;
        varying float vH;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vH = aSway.y;
        ${mode === 'float' ? `
        {
          // yüzeyde yavaş sürüklenme ve dalgayla hafif inip çıkma; kökler akıntıda geride kalır
          vec2 drift = vec2(sin(uTime * 0.045 + uPhase), cos(uTime * 0.037 + uPhase * 1.7)) * 1.6;
          float lag = aSway.x;
          vec2 dLag = vec2(sin(uTime * 0.045 + uPhase - lag * 0.6), cos(uTime * 0.037 + uPhase * 1.7 - lag * 0.6)) * 1.6;
          transformed.xz += mix(drift, dLag, min(lag, 1.0));
          transformed.y += sin(uTime * 0.9 + uPhase + position.x * 0.4) * 0.05 * (1.0 - min(lag, 1.0));
          transformed.x += sin(uTime * 0.7 + uPhase + position.y * 0.5) * lag * lag * 0.6;
          transformed.z += cos(uTime * 0.55 + uPhase * 1.3 + position.y * 0.4) * lag * lag * 0.45;
        }` : `
        {
          float b = aSway.x * aSway.x;
          transformed.x += (sin(uTime * 0.8 + uPhase + position.y * 0.15) * 0.8 + sin(uTime * 1.9 + uPhase * 2.0) * 0.15) * b;
          transformed.z += cos(uTime * 0.6 + uPhase * 1.3 + position.y * 0.12) * b * 0.6;
        }`}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uHealth;
        uniform vec3 uUnder;
        varying float vH;
        float ph21b(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 17853.3); }
        float pnb(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(ph21b(i), ph21b(i+vec2(1,0)), f.x), mix(ph21b(i+vec2(0,1)), ph21b(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          if (!gl_FrontFacing) diffuseColor.rgb *= uUnder;
          float sick = clamp(1.0 - uHealth, 0.0, 1.0);
          float spots = smoothstep(0.55, 0.75, pnb(vWPos.xz * 2.5 + vWPos.y));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.48, 0.16), sick * (0.6 + spots * 0.4));
          float alg = smoothstep(0.35, 0.8, pnb(vWPos.xz * 1.7 + vWPos.y) * 0.6 + pnb(vWPos.xy * 9.0) * 0.5) * uAlgae * (1.0 - vH * 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.24, 0.08), alg * 0.75);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vec3(0.2, 0.45, 0.12) * uLamp * ${mode === 'float' ? '0.04' : '0.12'};`);
  };
}

function makeMat(kind, opts, uniforms) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, ...opts });
  return patchUnderwater(m, { key: 'proc-' + kind, extra: procShader(kind === 'frogbit' || kind === 'frogroot' ? 'float' : 'stem'), uniforms });
}

// Amazon frogbit (Limnobium laevigatum): yüzen yuvarlak, kalın, parlak yapraklı rozet ve sarkan tüylü kökler
export function buildFrogbit(seed, uniforms) {
  const r = mulberry(seed);
  const leaves = [], roots = [];
  const n = 4 + Math.floor(r() * 4);
  const col = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r() * 0.6;
    const rad = 0.9 + r() * 0.7;
    const g = new THREE.CircleGeometry(rad, 22);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const d = Math.hypot(x, z) / rad;
      p.setY(i, d * d * 0.18 - 0.05 * (1 - d));  // kenarları hafif kalkık, kaşık gibi
    }
    // kalp biçimli taban çentiği
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      if (x < -rad * 0.6 && Math.abs(z) < rad * 0.15) p.setX(i, x * 0.8);
    }
    g.rotateY(-a);
    g.translate(Math.cos(a) * rad * 1.15, 0, Math.sin(a) * rad * 1.15);
    g.computeVertexNormals();
    col.setHSL(0.27 + r() * 0.04, 0.55, 0.1 + r() * 0.04);
    leaves.push(tag(g, 0, 1, col));
  }
  // kökler: uzun ve ince, uçları koyulaşan; kök tüyleri için ikinci, daha ince katman
  const nr = 7 + Math.floor(r() * 7);
  for (let k = 0; k < nr; k++) {
    const len = 3 + r() * 7;
    const a = r() * Math.PI * 2, o = r() * 0.6;
    const pts = [];
    for (let j = 0; j <= 6; j++) {
      const t = j / 6;
      pts.push(new THREE.Vector3(Math.cos(a) * (o + t * 0.8) + Math.sin(t * 4 + k) * 0.2, -t * len, Math.sin(a) * (o + t * 0.8)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, 12, 0.035 + r() * 0.02, 4, false);
    col.setRGB(0.42, 0.36, 0.26);
    roots.push(tag(g, (pos, i) => Math.min(1, -pos.getY(i) / 6), 0, col));
    // kök tüyleri: alt yarıda yana açılan kısa lifler
    for (let hh = 0; hh < 5; hh++) {
      const t = 0.35 + hh * 0.12;
      const base = curve.getPoint(t);
      const ha = r() * Math.PI * 2;
      const hc = new THREE.LineCurve3(base, base.clone().add(new THREE.Vector3(Math.cos(ha) * 0.35, -0.25, Math.sin(ha) * 0.35)));
      const hg = new THREE.TubeGeometry(hc, 1, 0.012, 3, false);
      roots.push(tag(hg, (pos, i) => Math.min(1, -pos.getY(i) / 6), 0, col.setRGB(0.5, 0.46, 0.38)));
    }
  }
  const group = new THREE.Group();
  const leafMesh = new THREE.Mesh(mergeGeometries(leaves), makeMat('frogbit', { roughness: 0.5, metalness: 0, envMapIntensity: 0.5 }, { ...uniforms, uUnder: { value: new THREE.Color(1.1, 1.15, 0.9) } }));
  const rootMesh = new THREE.Mesh(mergeGeometries(roots), makeMat('frogroot', { roughness: 0.7, transparent: true, opacity: 0.85 }, { ...uniforms, uUnder: { value: new THREE.Color(1, 1, 1) } }));
  leafMesh.castShadow = true;
  group.add(leafMesh, rootMesh);
  return group;
}

// Ludwigia repens 'Rubin': karşılıklı oval yapraklı dik gövdeler; alt yapraklar zeytin yeşili, tepeler bakır-kızıl
export function buildLudwigia(seed, uniforms) {
  const r = mulberry(seed);
  const parts = [];
  const col = new THREE.Color(), top = new THREE.Color(0.3, 0.03, 0.015), low = new THREE.Color(0.06, 0.1, 0.02);
  const leafProto = ovalLeaf();
  const stems = 5 + Math.floor(r() * 4);
  for (let s = 0; s < stems; s++) {
    const H = 14 + r() * 12;
    const bx = (r() - 0.5) * 5, bz = (r() - 0.5) * 4;
    const lean = new THREE.Vector2((r() - 0.5) * 0.15, (r() - 0.5) * 0.15);
    const at = (t) => new THREE.Vector3(bx + lean.x * t * H + Math.sin(t * 3 + s) * 0.3, t * H, bz + lean.y * t * H);
    const pts = []; for (let j = 0; j <= 8; j++) pts.push(at(j / 8));
    const stem = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.09, 5, false);
    parts.push(tag(stem, (pos, i) => pos.getY(i) / 26, 0.5, col.setRGB(0.12, 0.05, 0.02)));
    // düğümler: her düğümde 90° dönen karşılıklı iki yaprak (çapraz dizilim)
    const nodes = Math.floor(H / 1.5);
    for (let k = 1; k <= nodes; k++) {
      const t = k / nodes;
      const c = at(t);
      const rot = k * Math.PI / 2 + s;
      const size = (2.0 + r() * 0.5) * (t > 0.85 ? 0.6 + (1 - t) * 2.5 : 1);
      col.copy(low).lerp(top, THREE.MathUtils.smoothstep(t, 0.35, 0.95));
      col.offsetHSL(0, 0, (r() - 0.5) * 0.04);
      for (const side of [0, Math.PI]) {
        const g = leafProto.clone();
        g.scale(size, size * 1.45, size);
        g.rotateX(-(0.25 + t * t * 0.7));               // alt yapraklar yataya yakın, tepe yaprakları dikleşip toplanır
        g.rotateY(rot + side);
        g.translate(c.x, c.y, c.z);
        parts.push(tag(g, (pos, i) => pos.getY(i) / 26, t, col));
      }
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), makeMat('ludwigia', { roughness: 0.7, envMapIntensity: 0.4 }, { ...uniforms, uUnder: { value: new THREE.Color(1.6, 0.45, 0.5) } }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

function ovalLeaf() {
  const segs = 8, cols = 4, verts = [], uvs = [], idx = [];
  for (let j = 0; j <= segs; j++) {
    const t = j / segs;
    const w = 0.42 * Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.8)))) + 0.01;
    for (let i = 0; i <= cols; i++) {
      const sx = i / cols * 2 - 1;
      verts.push(sx * w, t, Math.abs(sx) * w * 0.25 - Math.sin(t * Math.PI) * 0.06);
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
  g.rotateX(Math.PI / 2);   // yaprak +Z yönünde uzar (yatay)
  g.computeVertexNormals();
  return g;
}
