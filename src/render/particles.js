import * as THREE from 'three';
import { TANK } from '../config.js';
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

// Hava taşı kabarcıkları (CPU tarafında güncellenir; sayı az)
export function createBubbles(source, max = 260) {
  const pos = new Float32Array(max * 3);
  const size = new Float32Array(max);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...WU, uPx: { value: window.devicePixelRatio } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      uniform float uPx;
      varying vec3 vWPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vec4 mv = viewMatrix * wp;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPx * 560.0 / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWPos;
      ${WATER_GLSL}
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        if (d > 1.0) discard;
        float rim = smoothstep(0.65, 1.0, d) * (1.0 - smoothstep(0.92, 1.0, d));
        float hl = smoothstep(0.28, 0.0, length(c - vec2(-0.16, -0.16)));
        vec3 lamp = uLampColor * (0.15 + uLamp);
        vec3 col = lamp * (rim * 0.9 + hl * 1.6) + vec3(0.6, 0.8, 0.85) * 0.05;
        float a = rim * 0.75 + hl * 0.9 + 0.05;
        float fade = exp(-waterPath(vWPos) * 0.01);
        gl_FragColor = vec4(col * fade, a * fade);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;

  const parts = [];
  let acc = 0;
  pts.userData.enabled = true;
  pts.userData.update = (dt, flowX = 0) => {
    if (pts.userData.enabled) {
      acc += dt * 26;
      while (acc > 1 && parts.length < max) {
        acc -= 1;
        parts.push({
          x: source.x + (Math.random() - 0.5) * 1.6,
          y: source.y,
          z: source.z + (Math.random() - 0.5) * 0.8,
          s: 0.12 + Math.random() ** 2 * 0.35,
          ph: Math.random() * 6.28,
          v: 0,
        });
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const b = parts[i];
      b.v = Math.min(b.v + dt * 60, 14 + b.s * 25);
      b.y += b.v * dt;
      b.ph += dt * (8 + b.s * 10);
      b.x += Math.sin(b.ph) * dt * 2.2 + flowX * dt;
      b.z += Math.cos(b.ph * 0.8) * dt * 1.6;
      b.s *= 1 + dt * 0.06;
      if (b.y > TANK.water - 0.1) parts.splice(i, 1);
    }
    for (let i = 0; i < max; i++) {
      const b = parts[i];
      if (b) { pos[i * 3] = b.x; pos[i * 3 + 1] = b.y; pos[i * 3 + 2] = b.z; size[i] = b.s; }
      else size[i] = 0;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
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

