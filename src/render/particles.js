import * as THREE from 'three';
import { TANK, MOBILE } from '../config.js';
import { WU, WATER_GLSL, patchUnderwater } from './water.js';

// Suda asılı ince toz: su "dolu" görünsün
export function createDust(count = 700) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * (TANK.w - 1);
    pos[i * 3 + 1] = Math.random() * (TANK.water - 1);
    pos[i * 3 + 2] = (Math.random() - 0.5) * (TANK.d - 1);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...WU, uPx: { value: window.devicePixelRatio } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uPx;
      varying float vSeed;
      varying vec3 vWPos;
      uniform float uTime;
      uniform vec3 uBoxMin; uniform vec3 uBoxMax;
      void main() {
        vSeed = aSeed;
        vec3 p = position;
        float t = uTime * (0.15 + aSeed * 0.1);
        p.x += sin(t + aSeed * 40.0) * 1.2 + uTime * 0.12 * (aSeed - 0.3);
        p.y += sin(t * 0.7 + aSeed * 13.0) * 0.8 - uTime * 0.03 * aSeed;
        p.z += cos(t * 0.8 + aSeed * 27.0) * 1.0;
        vec3 size = uBoxMax - uBoxMin - 0.6;
        p = uBoxMin + 0.3 + mod(p - uBoxMin - 0.3, size);
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWPos = wp.xyz;
        vec4 mv = viewMatrix * wp;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.08 + aSeed * 0.14) * uPx * 420.0 / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      varying float vSeed;
      varying vec3 vWPos;
      ${WATER_GLSL}
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        float vis = 0.25 + uTurbidity * 1.6 + uAlgae * 0.4;
        float tw = 0.6 + 0.4 * sin(uTime * 2.0 + vSeed * 50.0);
        vec3 col = mix(vec3(0.9, 0.95, 0.85), vec3(0.55, 0.6, 0.35), uAlgae + uTurbidity * 0.5) * uLampColor * (0.06 + uLamp * 0.5) * tw;
        float fade = exp(-waterPath(vWPos) * 0.02);
        gl_FragColor = vec4(col * a * vis * fade, a * vis * fade);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return pts;
}

// Hava taşı kabarcıkları. Küçükler düz yükselir; büyükler basık ve zikzaklı.
// Yüzeye çıkanların bir kısmı kısa süre yüzeyde kalır, patlayınca dalga yapar.
export function createBubbles(source, max = MOBILE ? 360 : 640) {
  const pos = new Float32Array(max * 3);
  const size = new Float32Array(max);
  const phase = new Float32Array(max);
  const flat = new Float32Array(max);
  const geo = new THREE.BufferGeometry();
  const dyn = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', dyn(pos, 3));
  geo.setAttribute('aSize', dyn(size, 1));
  geo.setAttribute('aPhase', dyn(phase, 1));
  geo.setAttribute('aFlat', dyn(flat, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...WU, uScale: { value: 1000 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      attribute float aFlat;
      uniform float uScale;
      varying vec3 vWPos;
      varying float vPhase;
      varying float vFlat;
      varying float vOblate;
      varying float vCover;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vPhase = aPhase;
        vFlat = aFlat;
        vOblate = smoothstep(0.06, 0.2, aSize);
        vec4 mv = viewMatrix * wp;
        gl_Position = projectionMatrix * mv;
        float px = 2.0 * aSize * uScale / -mv.z;
        // piksel altı kabarcıklar silinmez, yalnızca sönükleşir
        vCover = clamp(px / 2.0, 0.0, 1.0);
        vCover *= vCover;
        gl_PointSize = max(px * 1.15, 2.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWPos;
      varying float vPhase;
      varying float vFlat;
      varying float vOblate;
      varying float vCover;
      ${WATER_GLSL}
      void main() {
        vec2 c = (gl_PointCoord - 0.5) * 2.3;
        c.y = -c.y;
        // basıklık ve yalpalama
        float asp = 1.0 + vOblate * (0.28 + 0.12 * sin(vPhase * 2.0)) + vFlat * 0.5;
        vec2 e = vec2(c.x * (1.0 + vOblate * 0.05 * sin(vPhase * 3.0 + c.y * 2.0)), c.y * asp);
        float d = length(e);
        if (d > 1.0) discard;
        if (vFlat > 0.5 && c.y < -0.15) discard; // yüzeydeki kabarcığın yalnızca kubbesi
        vec3 lamp = uLampColor * (0.08 + uLamp);
        float light = causticAt(vWPos).g;
        float top = clamp(0.5 + 0.6 * e.y, 0.0, 1.0);
        // kenarda tam iç yansıma: gümüşi halka; ortası saydam
        float rim = smoothstep(0.5, 0.93, d) * (1.0 - smoothstep(0.96, 1.0, d) * 0.5);
        float hl = smoothstep(0.26, 0.0, length(e - vec2(-0.22, 0.48)));
        float focus = smoothstep(0.32, 0.0, length(e - vec2(0.08, -0.55)));
        vec3 col = lamp * light * (rim * (0.25 + 0.9 * top) + hl * 2.4 + focus * 0.7);
        col += vec3(0.55, 0.75, 0.8) * 0.03 * rim;
        float a = (rim * 0.8 + hl * 0.9 + focus * 0.4 + 0.05) * vCover;
        vec3 T = exp(-waterSigma() * waterPath(vWPos));
        col = col * T + waterInscatter() * (1.0 - T) * 0.2;
        gl_FragColor = vec4(col, a * (0.4 + 0.6 * dot(T, vec3(0.333))));
      }`,
    transparent: true,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;

  const parts = [];
  let acc = 0;
  const top = TANK.water;
  pts.userData.enabled = true;
  pts.userData.onPop = null;
  // Piksel boyutu o an çizilen hedefe göre (ana görüntü, yansıma, ayna)
  const _sz = new THREE.Vector2();
  pts.onBeforeRender = (renderer, scene, camera) => {
    const rt = renderer.getRenderTarget();
    const h = rt ? rt.height : renderer.getDrawingBufferSize(_sz).y;
    mat.uniforms.uScale.value = h * camera.projectionMatrix.elements[5] / 2;
  };
  const pop = (b) => { if (pts.userData.onPop) pts.userData.onPop(b.x, b.z, b.r); };

  pts.userData.update = (dt, flowX = 0) => {
    const rnd = Math.random;
    if (pts.userData.enabled) {
      acc += dt * 75;
      while (acc > 1 && parts.length < max) {
        acc -= 1;
        // çoğu milimetrik, arada iri bir kabarcık
        const r = 0.03 + rnd() ** 3 * 0.17 + (rnd() < 0.03 ? 0.08 : 0);
        const a = rnd() * 6.283, rr = Math.sqrt(rnd()) * 0.9;
        parts.push({
          x: source.x + Math.cos(a) * rr, y: source.y, z: source.z + Math.sin(a) * rr * 0.6,
          r, ph: rnd() * 6.28, v: 0, vx: 0, vz: 0, surf: false, life: 0,
          zig: THREE.MathUtils.smoothstep(r, 0.07, 0.16) * (4 + rnd() * 4),
          vt: Math.min(25, 9 + r * 170) * (0.9 + rnd() * 0.2),
        });
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const b = parts[i];
      if (b.surf) {
        b.life -= dt;
        b.x += b.vx * dt; b.z += b.vz * dt;
        b.vx *= 1 - dt * 1.2; b.vz *= 1 - dt * 1.2;
        if (b.life <= 0) { pop(b); parts.splice(i, 1); }
        continue;
      }
      b.v += (b.vt - b.v) * Math.min(1, dt * 18);
      b.y += b.v * dt;
      b.ph += dt * (7 + b.r * 20);
      // tüy (plume) yükseldikçe genişler
      b.vx += (rnd() - 0.5) * dt * 26; b.vz += (rnd() - 0.5) * dt * 20;
      b.vx *= 1 - dt * 1.4; b.vz *= 1 - dt * 1.4;
      b.x += (b.vx + Math.cos(b.ph) * b.zig + flowX) * dt;
      b.z += (b.vz + Math.sin(b.ph * 0.7) * b.zig * 0.5) * dt;
      if (b.y > top - b.r * 0.5) {
        if (b.r > 0.055 && rnd() < 0.75) {
          b.surf = true;
          b.y = top - b.r * 0.35;
          b.life = 0.12 + rnd() ** 2 * 1.6;
          const ang = Math.atan2(b.z - source.z, b.x - source.x) + (rnd() - 0.5);
          b.vx = Math.cos(ang) * (2 + rnd() * 4); b.vz = Math.sin(ang) * (2 + rnd() * 4);
        } else { pop(b); parts.splice(i, 1); }
      }
    }
    for (let i = 0; i < max; i++) {
      const b = parts[i];
      if (b) {
        pos[i * 3] = b.x; pos[i * 3 + 1] = b.y; pos[i * 3 + 2] = b.z;
        size[i] = b.r; phase[i] = b.ph; flat[i] = b.surf ? 1 : 0;
      } else size[i] = 0;
    }
    for (const k of ['position', 'aSize', 'aPhase', 'aFlat']) geo.attributes[k].needsUpdate = true;
    geo.setDrawRange(0, Math.max(parts.length, 1));
  };
  return pts;
}

// Yem pulları: çizim için instanced küçük düzensiz pullar
export function createFoodMesh(max = 240) {
  const geo = new THREE.CircleGeometry(0.28, 5);
  const p = geo.attributes.position;
  for (let i = 1; i < p.count; i++) {
    p.setX(i, p.getX(i) * (0.7 + Math.random() * 0.6));
    p.setY(i, p.getY(i) * (0.7 + Math.random() * 0.6));
  }
  const mat = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0xd08a3a, roughness: 0.8, side: THREE.DoubleSide }), { key: 'food' });
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true;
  return mesh;
}

