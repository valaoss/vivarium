import * as THREE from 'three';
import { TANK, HALF_W, HALF_D } from '../config.js';
import { WU } from './water.js';

export const ALGAE_GRID = { w: 72, h: 44 };

/**
 * Cam paneller (ön, sol, sağ), cam kenarları, siyah arka fon, lamba armatürü.
 * Ön camda yosun maskesi vardır: data dokusu + shader içinde ince detay.
 */
export function createTank(scene) {
  const g = TANK.glass;
  const group = new THREE.Group();

  // Ön camdaki yosun yoğunluğu (0..1)
  const algaeData = new Uint8Array(ALGAE_GRID.w * ALGAE_GRID.h);
  const algaeTex = new THREE.DataTexture(algaeData, ALGAE_GRID.w, ALGAE_GRID.h, THREE.RedFormat);
  algaeTex.magFilter = THREE.LinearFilter;
  algaeTex.minFilter = THREE.LinearFilter;
  algaeTex.needsUpdate = true;

  const glassUniforms = {
    uLamp: WU.uLamp,
    uLampColor: WU.uLampColor,
    uAlgaeMap: { value: algaeTex },
    uUseAlgae: { value: 0 },
    uTap: { value: new THREE.Vector4(0, 0, -100, 0) },
    uTime: WU.uTime,
  };

  const glassMat = (useAlgae) => new THREE.ShaderMaterial({
    uniforms: { ...glassUniforms, uUseAlgae: { value: useAlgae ? 1 : 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vWPos;
      varying vec3 vN;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWPos;
      varying vec3 vN;
      varying vec2 vUv;
      uniform float uLamp;
      uniform vec3 uLampColor;
      uniform sampler2D uAlgaeMap;
      uniform float uUseAlgae;
      uniform float uTime;

      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
      }

      vec3 roomEnv(vec3 R) {
        // Loş oda + soldaki pencere + sıcak abajur + tavandaki lamba
        vec3 c = mix(vec3(0.025, 0.02, 0.016), vec3(0.06, 0.055, 0.05), clamp(R.y * 0.5 + 0.5, 0.0, 1.0));
        vec3 win = normalize(vec3(-0.75, 0.35, 0.55));
        float w = smoothstep(0.86, 0.96, dot(R, win));
        c += vec3(0.55, 0.62, 0.75) * w * 0.55;
        vec3 lampDir = normalize(vec3(-0.85, 0.05, 0.25));
        c += vec3(1.0, 0.62, 0.32) * smoothstep(0.985, 0.998, dot(R, lampDir)) * 1.4;
        c += uLampColor * uLamp * smoothstep(0.9, 1.0, R.y) * 0.6;
        return c;
      }

      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWPos);
        if (dot(N, V) < 0.0) N = -N;
        float cosT = max(dot(N, V), 0.0);
        float fres = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
        vec3 R = reflect(-V, N);
        vec3 refl = roomEnv(R) * fres * 1.6;
        // camın hafif yeşil tonu + açıyla artan koyulaşma
        float tintA = 0.03 + (1.0 - cosT) * 0.12;
        vec3 col = refl;
        float a = tintA + fres * 0.3;

        if (uUseAlgae > 0.5) {
          float m = texture2D(uAlgaeMap, vUv).r;
          float detail = vnoise(vUv * vec2(180.0, 110.0)) * 0.6 + vnoise(vUv * vec2(40.0, 25.0)) * 0.6;
          float alg = smoothstep(0.15, 0.9, m * (0.55 + detail * 0.7));
          vec3 algCol = mix(vec3(0.12, 0.2, 0.05), vec3(0.28, 0.36, 0.1), detail);
          algCol *= 0.25 + uLamp * 0.75 * uLampColor;
          col = mix(col, algCol, alg * 0.85);
          a = mix(a, 0.82, alg);
        }
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const frontMat = glassMat(true);
  const sideMat = glassMat(false);

  // Ön panel (UV'ler yosun ızgarasıyla eşleşir)
  const front = new THREE.Mesh(new THREE.PlaneGeometry(TANK.w + 2 * g, TANK.h + g), frontMat);
  front.position.set(0, (TANK.h - g) / 2, HALF_D + g * 0.5);
  front.renderOrder = 10;
  front.name = 'frontGlass';
  group.add(front);

  const left = new THREE.Mesh(new THREE.PlaneGeometry(TANK.d, TANK.h + g), sideMat);
  left.rotation.y = -Math.PI / 2;
  left.position.set(-HALF_W - g * 0.5, (TANK.h - g) / 2, 0);
  left.renderOrder = 10;
  const right = left.clone();
  right.rotation.y = Math.PI / 2;
  right.position.x = HALF_W + g * 0.5;
  // Arka cam: yan camlarla aynı malzeme
  const backGlass = new THREE.Mesh(new THREE.PlaneGeometry(TANK.w + 2 * g, TANK.h + g), sideMat);
  backGlass.position.set(0, (TANK.h - g) / 2, -HALF_D - g * 0.5);
  backGlass.renderOrder = 10;
  group.add(left, right, backGlass);

  // Cam kenarları: kalın camın yeşilimsi kesiti
  const edgeMat = new THREE.MeshPhysicalMaterial({
    color: 0x6fae98, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.32,
    emissive: 0x12302a, emissiveIntensity: 0.25, clearcoat: 1, depthWrite: false,
  });
  const vEdge = new THREE.BoxGeometry(g, TANK.h + g, g);
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const e = new THREE.Mesh(vEdge, edgeMat);
    e.position.set(x * (HALF_W + g / 2), (TANK.h - g) / 2, z * (HALF_D + g / 2));
    e.renderOrder = 11;
    group.add(e);
  }
  const topEdgeX = new THREE.BoxGeometry(TANK.w + 2 * g, g * 0.6, g);
  const topEdgeZ = new THREE.BoxGeometry(g, g * 0.6, TANK.d);
  for (const z of [-1, 1]) {
    const e = new THREE.Mesh(topEdgeX, edgeMat);
    e.position.set(0, TANK.h - g * 0.2, z * (HALF_D + g / 2));
    e.renderOrder = 11;
    group.add(e);
  }
  for (const x of [-1, 1]) {
    const e = new THREE.Mesh(topEdgeZ, edgeMat);
    e.position.set(x * (HALF_W + g / 2), TANK.h - g * 0.2, 0);
    e.renderOrder = 11;
    group.add(e);
  }
  // Alt cam (kesit, önden görünen ince yeşil çizgi)
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(TANK.w + 2 * g, g, TANK.d + 2 * g), edgeMat);
  bottom.position.y = -g / 2;
  bottom.renderOrder = 11;
  group.add(bottom);

  // Siyah silikon köşe izleri (içeriden)
  const silMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.5 });
  const sil = new THREE.BoxGeometry(0.35, TANK.h - 0.5, 0.35);
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const s = new THREE.Mesh(sil, silMat);
    s.position.set(x * (HALF_W - 0.17), TANK.h / 2 - 0.25, z * (HALF_D - 0.17));
    group.add(s);
  }

  // Arka fon: koyu lacivert-siyah folyo (gerçek akvaryumlardaki gibi).
  // Tek yüzlü: önden siyah fon görünür, arkadan bakınca cam gibi tankın içi görünür.
  const film = new THREE.Mesh(
    new THREE.PlaneGeometry(TANK.w + 2 * g, TANK.h + g),
    new THREE.MeshStandardMaterial({ color: 0x03070a, roughness: 0.75, metalness: 0 }),
  );
  film.position.set(0, (TANK.h - g) / 2, -HALF_D - g * 1.05);
  group.add(film);

  // Lamba armatürü: ince alüminyum gövde, altı parlak
  const lampBody = new THREE.Mesh(
    new THREE.BoxGeometry(TANK.w - 4, 1.0, 7),
    new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.85, roughness: 0.35 }),
  );
  lampBody.position.set(0, TANK.h + 4.2, 2);
  group.add(lampBody);
  const lampEmitMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lampEmit = new THREE.Mesh(new THREE.PlaneGeometry(TANK.w - 6, 5.2), lampEmitMat);
  lampEmit.rotation.x = Math.PI / 2;
  lampEmit.position.set(0, TANK.h + 3.68, 2);
  group.add(lampEmit);
  // Ayaklar
  const legMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4.4, 1.2), legMat);
    leg.position.set(s * (HALF_W + g + 0.4), TANK.h + 1.9, 2);
    group.add(leg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.6, 1.2), legMat);
    arm.position.set(s * (HALF_W + 0.2), TANK.h + 4.1, 2);
    group.add(arm);
  }

  scene.add(group);

  return {
    group,
    front,
    algaeData,
    algaeTex,
    lampEmitMat,
    setTap(x, y, t) { frontMat.uniforms.uTap.value.set(x, y, t, 1); },
  };
}
