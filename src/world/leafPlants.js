import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchUnderwater, plantWaterMotion } from '../render/water.js';
import { mulberry } from '../render/textures.js';
import { foliageShader } from '../render/materials.js';

/*
 * Yapraklı su bitkileri (yerel birim: cm, taban orijinde). Her yaprak bir orta damar eğrisi boyunca
 * kurulur: sap yükselir, ayası türüne göre sarkar, kıvrılır, orta damardan V biçiminde katlanır ve
 * kenarı dalgalanır. Doku tuvalde türüne göre boyanır: orta damar, yan damarlar (tüysü / kavisli /
 * paralel), uçta ve kenarda açılan ton, benekler; kabartma (normal) haritası aynı damarlardan çıkar.
 * UV: u = yaprak genişliği boyunca (0..LEAF_U), v = tabandan uca. Rizom ve kökler dokunun sağ şeridinden boyanır.
 */

const LEAF_U = 0.88;         // dokunun sol kısmı yaprak, sağ şerit rizom/kök
const TEX_W = 256, TEX_H = 1024;

// ---------------------------------------------------------------- tür tanımları
// shape: ayanın genişlik profili (u: ayanın 0..1'i) · veins: damar düzeni · colors: [taban, orta, uç, damar, sap]
export const LEAF_SPECIES = {
  sword: {
    petiole: 0.34, width: 0.17, shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.62)) * (1 - u * 0.18), veins: 'arcuate',
    colors: ['#3e6a22', '#5d8f2c', '#86b545', '#a8cf72', '#5f7f2d'], rough: 0.5, fold: 0.18, wave: 0.0, under: [0.95, 1.05, 0.85], gloss: 0.15,
  },
  crypt: {
    petiole: 0.3, width: 0.2, shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.7)) * (1 - u * 0.1), veins: 'pinnate',
    colors: ['#33421a', '#465a22', '#5d702e', '#76844a', '#5b3a22'], rough: 0.55, fold: 0.12, wave: 0.025, under: [1.35, 0.6, 0.55], gloss: 0.1, mottle: 0.35,
  },
  anubias: {
    petiole: 0.28, width: 0.33, shape: (u) => Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.pow(u, 0.85)))) * (1 - u * 0.12), veins: 'pinnate',
    colors: ['#0f2a0d', '#143412', '#1d4518', '#2c5a24', '#2a3f1a'], rough: 0.32, fold: 0.1, wave: 0.012, under: [1.1, 1.15, 0.95], gloss: 0.45,
  },
  javafern: {
    petiole: 0.06, width: 0.1, shape: (u) => Math.sin(Math.PI * Math.pow(u, 0.5)) * (1 - u * 0.3), veins: 'pinnate',
    colors: ['#2a4a1a', '#3d6424', '#56802f', '#25401a', '#3b4a22'], rough: 0.5, fold: 0.22, wave: 0.02, under: [1.05, 1.1, 0.9], gloss: 0.2, raised: true,
  },
  vallisneria: {
    petiole: 0.0, width: 1, shape: (u) => 1 - Math.pow(u, 14) * 0.85, veins: 'parallel', ribbon: true,
    colors: ['#6b8f32', '#7fa83c', '#98bd52', '#a9c96b', '#c8c08a'], rough: 0.5, fold: 0.04, wave: 0.0, under: [1.05, 1.05, 0.95], gloss: 0.15,
  },
};

// ---------------------------------------------------------------- doku
const texCache = {};
function leafTextures(kind) {
  if (texCache[kind]) return texCache[kind];
  const S = LEAF_SPECIES[kind];
  const r = mulberry(kind.length * 977 + 13);
  const cv = document.createElement('canvas'); cv.width = TEX_W; cv.height = TEX_H;
  const c = cv.getContext('2d');
  const hv = document.createElement('canvas'); hv.width = TEX_W; hv.height = TEX_H;
  const h = hv.getContext('2d');
  const LW = TEX_W * LEAF_U;
  const [base, mid, tip, vein, stalk] = S.colors;
  // v=0 (taban) tuvalin altında
  const Y = (v) => TEX_H * (1 - v);
  const X = (u) => u * LW;

  // zemin rengi: tabandan uca, ayrıca sap bölgesi
  const g = c.createLinearGradient(0, TEX_H, 0, 0);
  g.addColorStop(0, stalk); g.addColorStop(Math.max(0.001, S.petiole * 0.95), stalk);
  g.addColorStop(Math.min(0.99, S.petiole + 0.05), base); g.addColorStop(0.55, mid); g.addColorStop(1, tip);
  c.fillStyle = g; c.fillRect(0, 0, LW, TEX_H);
  h.fillStyle = '#808080'; h.fillRect(0, 0, TEX_W, TEX_H);

  // kenara doğru hafif açılma ve ince kenar çizgisi
  const eg = c.createLinearGradient(0, 0, LW, 0);
  eg.addColorStop(0, 'rgba(210,230,150,0.22)'); eg.addColorStop(0.18, 'rgba(210,230,150,0)');
  eg.addColorStop(0.82, 'rgba(210,230,150,0)'); eg.addColorStop(1, 'rgba(210,230,150,0.22)');
  c.fillStyle = eg; c.fillRect(0, Y(1), LW, Y(S.petiole) - Y(1));

  // benekler / doku dalgalanması (kriptokorin alacası, genel klorofil düzensizliği)
  for (let i = 0; i < 900; i++) {
    const u = r(), v = S.petiole + r() * (1 - S.petiole), rad = 2 + r() * 10;
    const dark = r() < 0.5;
    c.fillStyle = dark ? `rgba(20,30,8,${0.03 + (S.mottle ?? 0) * 0.12 * r()})` : `rgba(200,220,120,${0.025 + (S.mottle ?? 0) * 0.06 * r()})`;
    c.beginPath(); c.ellipse(X(u), Y(v), rad, rad * (1.5 + r()), 0, 0, Math.PI * 2); c.fill();
  }
  // ince hücre dokusu (yalnız kabartma)
  for (let i = 0; i < 6000; i++) {
    h.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)';
    h.fillRect(r() * LW, r() * TEX_H, 1 + r() * 2, 1 + r() * 2);
  }

  const line = (ctx, pts, w, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); pts.forEach(([u, v], i) => (i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v)))); ctx.stroke();
  };
  const sunk = S.raised ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  const vb = S.petiole;
  if (S.veins === 'parallel') {
    for (let k = 0; k < 13; k++) {
      const u = 0.06 + k / 12 * 0.88, strong = k % 4 === 0;
      line(c, [[u, 0], [u, 1]], strong ? 1.6 : 0.8, strong ? 'rgba(190,215,120,0.35)' : 'rgba(170,200,110,0.18)');
      line(h, [[u, 0], [u, 1]], strong ? 2.5 : 1.2, sunk);
    }
    // enine ince bağlantılar (vallisneria yaprağında görünen merdiven)
    for (let i = 0; i < 260; i++) {
      const v = r(), u = 0.06 + Math.floor(r() * 12) / 12 * 0.88;
      line(c, [[u, v], [u + 0.073, v]], 0.6, 'rgba(160,190,100,0.16)');
    }
  } else {
    // orta damar: tabanda kalın, uca doğru incelir
    for (let k = 0; k < 24; k++) {
      const v0 = vb + (1 - vb) * k / 24, v1 = vb + (1 - vb) * (k + 1) / 24;
      const w = 7 * (1 - k / 26) + 1;
      line(c, [[0.5, v0], [0.5, v1]], w, vein);
      line(h, [[0.5, v0], [0.5, v1]], w * 1.2, S.raised ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.65)');
    }
    // sap: orta damar sapa dek iner
    line(c, [[0.5, 0], [0.5, vb]], 10, stalk);
    if (S.veins === 'arcuate') {
      // Echinodorus: tabandan uca, kenara paralel kavisli 2-3 çift ana damar + ince enine damarlar
      for (const side of [-1, 1]) for (const k of [0.17, 0.31]) {
        const pts = [];
        for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push([0.5 + side * k * Math.sin(Math.PI * Math.pow(t, 0.7)) * 1.25, vb + t * (1 - vb)]); }
        line(c, pts, 2.2, 'rgba(170,205,110,0.55)');
        line(h, pts, 3, sunk);
      }
      for (let i = 0; i < 70; i++) {
        const v = vb + 0.04 + r() * (1 - vb - 0.08), side = r() < 0.5 ? -1 : 1;
        line(c, [[0.5, v], [0.5 + side * 0.42, v + 0.01]], 0.7, 'rgba(160,195,100,0.22)');
        line(h, [[0.5, v], [0.5 + side * 0.42, v + 0.01]], 1, 'rgba(0,0,0,0.18)');
      }
    } else {
      // tüysü: yan damarlar orta damardan uca doğru açıyla çıkar, kenara yaklaşınca yukarı kıvrılıp bir öncekine bağlanır
      const n = kind === 'javafern' ? 26 : 16;
      for (let k = 0; k < n; k++) {
        const v0 = vb + 0.03 + (1 - vb - 0.1) * (k + 0.5 * r()) / n;
        for (const side of [-1, 1]) {
          const pts = [];
          for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([0.5 + side * 0.45 * t, v0 + (0.05 + 0.09 * t * t) * (kind === 'javafern' ? 0.7 : 1)]); }
          line(c, pts, 1.5, kind === 'anubias' ? 'rgba(90,140,70,0.35)' : 'rgba(150,190,90,0.35)');
          line(h, pts, 2.4, sunk);
        }
      }
    }
  }
  // ucu ve kenarı yaşlı yaprakta hafif kahve (ışık yanığı / yaşlanma)
  const tg = c.createLinearGradient(0, Y(1), 0, Y(0.9));
  tg.addColorStop(0, 'rgba(110,90,30,0.35)'); tg.addColorStop(1, 'rgba(110,90,30,0)');
  c.fillStyle = tg; c.fillRect(0, Y(1), LW, Y(0.9) - Y(1));

  // rizom / kök şeridi: kahverengi, boğumlu
  const rx = LW + 2, rw = TEX_W - rx;
  c.fillStyle = '#4a3a22'; c.fillRect(rx, 0, rw, TEX_H);
  for (let y = 0; y < TEX_H; y += 6 + r() * 14) {
    c.fillStyle = `rgba(${r() < 0.5 ? '20,14,6' : '110,90,55'},0.35)`; c.fillRect(rx, y, rw, 2 + r() * 3);
    h.fillStyle = 'rgba(0,0,0,0.35)'; h.fillRect(rx, y, rw, 2);
  }

  // yükseklik → normal haritası
  const src = h.getImageData(0, 0, TEX_W, TEX_H).data;
  const out = c.createImageData(TEX_W, TEX_H);
  const H = (x, y) => src[(((y + TEX_H) % TEX_H) * TEX_W + ((x + TEX_W) % TEX_W)) * 4] / 255;
  const k = 2.2;
  for (let y = 0; y < TEX_H; y++) for (let x = 0; x < TEX_W; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * k, dy = (H(x, y - 1) - H(x, y + 1)) * k;
    const l = Math.hypot(dx, dy, 1), i = (y * TEX_W + x) * 4;
    out.data[i] = (-dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  const nv = document.createElement('canvas'); nv.width = TEX_W; nv.height = TEX_H;
  nv.getContext('2d').putImageData(out, 0, 0);

  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(nv);
  for (const t of [map, normalMap]) { t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  return (texCache[kind] = { map, normalMap });
}

// ---------------------------------------------------------------- malzeme
function leafShader(shader) {
  foliageShader(shader);
  plantWaterMotion(shader, 'aSway.x * aSway.x');
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      uniform float uTime;
      uniform float uPhase;
      attribute vec3 aSway;   // x: esneme ağırlığı (tabanda 0), y: yaprağın fazı, z: esneklik
      varying float vAge;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vAge = aSway.z;
      {
        // her yaprak kendi fazında ve akıntı yönünde yavaşça salınır; uca doğru gecikmeli dalga
        float b = aSway.x * aSway.x * aSway.z;
        float ph = uPhase + aSway.y;
        transformed.x += (sin(uTime * 0.8 + ph - aSway.x * 1.6) * 0.7 + sin(uTime * 1.9 + ph * 2.0) * 0.12) * b;
        transformed.z += cos(uTime * 0.6 + ph * 1.3 - aSway.x * 1.2) * b * 0.55;
      }`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uHealth;
      uniform vec3 uUnder;
      varying float vAge;
      float lh21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 17853.3); }
      float lnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(lh21(i), lh21(i+vec2(1,0)), f.x), mix(lh21(i+vec2(0,1)), lh21(i+vec2(1,1)), f.x), f.y); }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      {
        // alt yüz açık / kızıl; sağlıksız yaprak sararır ve kahve lekelenir; yaşlı yapraklara yosun tutar
        if (!gl_FrontFacing) diffuseColor.rgb *= uUnder;
        float sick = clamp(1.0 - uHealth, 0.0, 1.0);
        float spots = smoothstep(0.55, 0.75, lnoise(vWPos.xz * 2.5 + vWPos.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.48, 0.16), sick * (0.6 + spots * 0.4));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.16, 0.08), sick * sick * spots);
        float alg = smoothstep(0.35, 0.8, lnoise(vWPos.xz * 1.7 + vWPos.y) * 0.6 + lnoise(vWPos.xy * 9.0) * 0.5) * uAlgae * (0.4 + vAge * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.24, 0.08), alg * 0.75);
      }`);
}

const matCache = {};
function leafMaterial(kind, uniforms) {
  const S = LEAF_SPECIES[kind];
  const { map, normalMap } = leafTextures(kind);
  const m = new THREE.MeshStandardMaterial({
    map, normalMap, normalScale: new THREE.Vector2(0.6, 0.6), vertexColors: true, side: THREE.DoubleSide,
    roughness: S.rough, metalness: 0, envMapIntensity: 0.4 + S.gloss,
  });
  return patchUnderwater(m, { key: 'leaf-' + kind, extra: leafShader, uniforms: { ...uniforms, uUnder: { value: new THREE.Color(...S.under) } } });
}

// ---------------------------------------------------------------- geometri
const _d = new THREE.Vector3(), _s = new THREE.Vector3(), _n = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

/*
 * Tek yaprak. o: { kind, len, yaw, rise (sapın yataydan açısı), droop (uca doğru sarkma), twist, curl (yanlara kıvrılma),
 * wid (genişlik çarpanı), age (0 genç .. 1 yaşlı), tint (Color), flex, phase, base (Vector3), top (yüzey sınırı) }
 */
function buildLeaf(o, r) {
  const S = LEAF_SPECIES[o.kind];
  const segs = S.ribbon ? 34 : 22, cols = S.ribbon ? 2 : 6;
  const pos = [], uv = [], col = [], sway = [], idx = [];
  const ds = o.len / segs;
  const p = _p.copy(o.base);
  const side0 = new THREE.Vector3(Math.cos(o.yaw), 0, -Math.sin(o.yaw));   // yaprağın sağ eli (yatay)
  let pitch = o.rise;
  const W = (S.ribbon ? o.wid : S.width * o.len * o.wid);
  const tmpC = new THREE.Color();
  let surfaced = false;
  for (let j = 0; j <= segs; j++) {
    const t = j / segs;
    // orta damar yönü: yatay yönden yukarı açı (pitch), sarkma uca doğru artar
    const pitchT = pitch - o.droop * Math.pow(t, 1.6);
    _d.set(Math.sin(o.yaw) * Math.cos(pitchT), Math.sin(pitchT), Math.cos(o.yaw) * Math.cos(pitchT));
    if (surfaced) _d.set(Math.sin(o.yaw), 0, Math.cos(o.yaw));
    // enine eksen: yatay sağ el, yaprak boyunca burulur
    _q.setFromAxisAngle(_d, o.twist * t + (S.ribbon ? Math.sin(t * 5 + o.phase) * 0.35 * t : 0));
    _s.copy(side0).applyQuaternion(_q);
    _n.crossVectors(_s, _d).normalize();
    // genişlik: sap ince, aya türün profiline göre
    const u = S.petiole ? Math.max(0, (t - S.petiole) / (1 - S.petiole)) : t;
    let w = t < S.petiole ? 0.06 + o.len * 0.006 : Math.max(0.06 + o.len * 0.004, W * Math.max(0.01, S.shape(u)));
    if (S.ribbon) w = W * S.shape(t) * 0.5;
    for (let i = 0; i <= cols; i++) {
      const sx = i / cols * 2 - 1;
      // V katlanma, kenar dalgası (kriptokorin, java eğreltisi), yanlara kıvrılma
      const fold = Math.abs(sx) * w * S.fold * (1 - t * 0.5);
      const wave = S.wave * o.len * Math.sin(t * 34 + sx * 0.5 + o.phase) * Math.abs(sx) ** 2 * (t > S.petiole ? 1 : 0);
      const curl = o.curl * sx * sx * w;
      const q = new THREE.Vector3().copy(p).addScaledVector(_s, sx * w).addScaledVector(_n, fold + wave + curl);
      pos.push(q.x, q.y, q.z);
      uv.push((sx * 0.5 + 0.5) * LEAF_U, t);
      // yaprak üstünde de renk: tabandan uca hafif açılma, yaşla koyulaşma/sararma, birey farkı
      tmpC.copy(o.tint).multiplyScalar(0.92 + 0.12 * t);
      col.push(tmpC.r, tmpC.g, tmpC.b);
      sway.push(Math.min(1, t * (S.ribbon ? 1 : 0.8) + (t > S.petiole ? 0.1 : 0)), o.phase, o.flex);
    }
    p.addScaledVector(_d, ds);
    // yaprak kumun içine girmez (yerel taban kumun 0,3 cm altında)
    if (p.y < 0.45) p.y = 0.45;
    // vallisneria su yüzeyine ulaşınca yüzeyde yatar
    if (o.top !== undefined && p.y > o.top) { p.y = o.top; surfaced = true; }
  }
  for (let j = 0; j < segs; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + cols + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// rizom / kök: dokunun sağ şeridini kullanan tüp
function buildTube(curve, radius, segs, radial, sw = 0) {
  const g = new THREE.TubeGeometry(curve, segs, radius, radial, false);
  const uvA = g.attributes.uv, n = g.attributes.position.count;
  for (let i = 0; i < n; i++) uvA.setXY(i, LEAF_U + 0.02 + uvA.getY(i) * (1 - LEAF_U - 0.03), uvA.getX(i));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 2 ? 1 : sw)), 3));
  return g;
}

function finish(kind, geos, uniforms) {
  const geo = mergeGeometries(geos, false);
  const mesh = new THREE.Mesh(geo, leafMaterial(kind, uniforms));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

// rozet bitkileri: yapraklar ortadan açılır; dış yapraklar yaşlı, yatık, büyük; iç yapraklar genç, dik, açık renkli
function rosette(kind, seed, uniforms, o) {
  const r = mulberry(seed);
  const S = LEAF_SPECIES[kind];
  const n = o.n[0] + Math.floor(r() * (o.n[1] - o.n[0] + 1));
  const geos = [];
  const golden = 2.39996;
  const baseCol = new THREE.Color(1, 1, 1);
  for (let k = 0; k < n; k++) {
    const age = 1 - k / Math.max(1, n - 1);                 // önce dıştaki yaşlı yapraklar
    const len = o.len * (0.55 + 0.45 * Math.sqrt(age) + (r() - 0.5) * 0.18) * (k === n - 1 ? 0.6 : 1);
    const tint = baseCol.clone().setRGB(1, 1, 1).multiplyScalar(0.82 + (1 - age) * 0.3 + (r() - 0.5) * 0.1);
    tint.g *= 1 + (1 - age) * 0.06;
    if (age > 0.8) tint.r *= 1.06;                          // en yaşlılar hafif sararır
    geos.push(buildLeaf({
      kind, len, yaw: k * golden + r() * 0.4, rise: o.rise[0] + (o.rise[1] - o.rise[0]) * (1 - age) + (r() - 0.5) * 0.15,
      droop: o.droop * (0.6 + age * 0.8) * (0.8 + r() * 0.4), twist: (r() - 0.5) * o.twist, curl: o.curl * (r() - 0.3),
      wid: 0.85 + r() * 0.3, age, tint, flex: o.flex * (0.8 + r() * 0.4), phase: r() * 6.28,
      base: new THREE.Vector3((r() - 0.5) * o.spread, 0, (r() - 0.5) * o.spread),
    }, r));
  }
  if (o.rhizome) geos.push(...o.rhizome(r));
  return finish(kind, geos, uniforms);
}

// ---------------------------------------------------------------- türler
// Amazon kılıcı (Echinodorus bleheri): uzun saplı, geniş mızrak yapraklı, kemerli büyük rozet
export const buildSword = (seed, u) => rosette('sword', seed, u, { n: [12, 17], len: 24, rise: [0.95, 1.45], droop: 0.75, twist: 0.5, curl: 0.12, flex: 0.9, spread: 1.2 });
// Kriptokorin (C. wendtii): orta boy, dalgalı kenarlı, kahve-yeşil rozet
export const buildCrypt = (seed, u) => rosette('crypt', seed, u, { n: [9, 14], len: 11, rise: [0.6, 1.25], droop: 0.55, twist: 0.6, curl: 0.15, flex: 0.6, spread: 1.6 });
// Anubias barteri: sürünen kalın rizomdan kısa saplı, koyu, parlak, geniş oval yapraklar
export const buildAnubias = (seed, u) => rosette('anubias', seed, u, {
  n: [6, 10], len: 8, rise: [0.5, 1.15], droop: 0.3, twist: 0.3, curl: -0.1, flex: 0.35, spread: 3.2,
  rhizome: (r) => {
    const a = r() * Math.PI;
    const pts = [-1.8, -0.6, 0.6, 1.8].map((t) => new THREE.Vector3(Math.cos(a) * t, 0.25 + Math.sin(t * 2) * 0.1, Math.sin(a) * t));
    const out = [buildTube(new THREE.CatmullRomCurve3(pts), 0.32, 12, 7)];
    for (let i = 0; i < 6; i++) {
      const s = pts[1 + (i % 2)].clone(), d = new THREE.Vector3(r() - 0.5, -0.6, r() - 0.5).normalize();
      out.push(buildTube(new THREE.CatmullRomCurve3([s, s.clone().addScaledVector(d, 0.8), s.clone().addScaledVector(d, 1.6).add(new THREE.Vector3(0, -0.2, 0))]), 0.05, 5, 3));
    }
    return out;
  },
});
// Java eğreltisi (Microsorum pteropus): rizomdan çıkan dar, uzun, kemerli mızrak yapraklar
export const buildJavafern = (seed, u) => rosette('javafern', seed, u, {
  n: [9, 14], len: 15, rise: [0.6, 1.35], droop: 0.75, twist: 0.8, curl: 0.25, flex: 0.7, spread: 3.6,
  rhizome: (r) => {
    const a = r() * Math.PI;
    const pts = [-2.2, -0.8, 0.8, 2.2].map((t) => new THREE.Vector3(Math.cos(a) * t, 0.3 + Math.sin(t * 1.7) * 0.15, Math.sin(a) * t));
    const out = [buildTube(new THREE.CatmullRomCurve3(pts), 0.22, 14, 6)];
    for (let i = 0; i < 9; i++) {
      const s = pts[i % 4].clone(), d = new THREE.Vector3(r() - 0.5, -0.5, r() - 0.5).normalize();
      out.push(buildTube(new THREE.CatmullRomCurve3([s, s.clone().addScaledVector(d, 0.9), s.clone().addScaledVector(d, 1.8).add(new THREE.Vector3(0, -0.3, 0))]), 0.035, 5, 3));
    }
    return out;
  },
});
// Vallisneria: koşucu sürgünlerle yayılan çim; uzun, ince, esnek şerit yapraklar, uzunsa yüzeyde yatar
export function buildVallisneria(seed, uniforms, { top } = {}) {
  const r = mulberry(seed);
  const geos = [];
  const clumps = 2 + Math.floor(r() * 2);
  for (let c = 0; c < clumps; c++) {
    const cx = (r() - 0.5) * 4, cz = (r() - 0.5) * 3;
    const n = 6 + Math.floor(r() * 5);
    for (let k = 0; k < n; k++) {
      const age = r();
      const tint = new THREE.Color(1, 1, 1).multiplyScalar(0.8 + (1 - age) * 0.3 + (r() - 0.5) * 0.12);
      geos.push(buildLeaf({
        kind: 'vallisneria', len: 18 + r() * 22 * (0.6 + age * 0.4), yaw: r() * Math.PI * 2, rise: 1.25 + r() * 0.25,
        droop: 0.35 + r() * 0.5, twist: (r() - 0.5) * 2.4, curl: 0.02, wid: 0.7 + r() * 0.45, age, tint,
        flex: 2.2 + r() * 1.6, phase: r() * 6.28, base: new THREE.Vector3(cx + (r() - 0.5) * 1.2, 0, cz + (r() - 0.5) * 1.2),
        top: top !== undefined ? top - 0.15 : undefined,
      }, r));
    }
  }
  return finish('vallisneria', geos, uniforms);
}
