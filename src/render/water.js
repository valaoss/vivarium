import * as THREE from 'three';
import { TANK, HALF_W, HALF_D } from '../config.js';

// Sualtındaki her materyalin paylaştığı uniform'lar. Tek yerden güncellenir.
export const WU = {
  uTime: { value: 0 },
  uLamp: { value: 1 },                                   // lamba yoğunluğu 0..1
  uLampColor: { value: new THREE.Color(1, 0.98, 0.94) },
  uAbsorb: { value: new THREE.Vector3(0.03, 0.0115, 0.0095) }, // cm başına emilim
  uScatter: { value: new THREE.Color(0.03, 0.11, 0.115) },   // suyun kendi saçılma rengi
  uTurbidity: { value: 0 },                               // 0 berrak .. 1 çok bulanık
  uAlgae: { value: 0 },                                   // yeşillenme 0..1
  uCaustic: { value: 1 },
  uBoxMin: { value: new THREE.Vector3(-HALF_W, 0, -HALF_D) },
  uBoxMax: { value: new THREE.Vector3(HALF_W, TANK.water, HALF_D) },
};

export const WATER_GLSL = /* glsl */ `
uniform float uTime;
uniform float uLamp;
uniform vec3 uLampColor;
uniform vec3 uAbsorb;
uniform vec3 uScatter;
uniform float uTurbidity;
uniform float uAlgae;
uniform float uCaustic;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;

vec2 wBoxHit(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (uBoxMin - ro) * inv;
  vec3 t1 = (uBoxMax - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

// Kameradan p noktasına giden ışının suyun içinde kat ettiği mesafe (cm)
float waterPath(vec3 p) {
  vec3 d = p - cameraPosition;
  float L = length(d);
  vec3 rd = d / L;
  vec2 t = wBoxHit(cameraPosition, rd);
  float a = max(t.x, 0.0);
  float b = min(t.y, L);
  return max(b - a, 0.0);
}

vec3 waterSigma() {
  // Bulanıklık her kanalı, yosun ise kırmızı/maviyi daha çok yutar (yeşile kayma)
  return uAbsorb + uTurbidity * vec3(0.06, 0.054, 0.065) + uAlgae * vec3(0.045, 0.012, 0.06);
}

vec3 waterInscatter() {
  vec3 murk = mix(vec3(0.22, 0.24, 0.17), vec3(0.12, 0.24, 0.06), uAlgae / max(uAlgae + uTurbidity, 0.001));
  vec3 base = mix(uScatter, murk, clamp(uTurbidity * 1.3 + uAlgae * 0.8, 0.0, 1.0));
  return base * (0.08 + uLamp * 0.92) * uLampColor;
}

vec3 applyWater(vec3 col, vec3 wp) {
  float d = waterPath(wp);
  vec3 T = exp(-waterSigma() * d);
  return col * T + waterInscatter() * (1.0 - T);
}

float causticLayer(vec2 p, float t) {
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

vec3 causticRGB(vec3 wp) {
  // Işık yukarıdan gelir; derinlik arttıkça desen genişler ve yumuşar
  float depth = clamp((uBoxMax.y - wp.y) / uBoxMax.y, 0.0, 1.0);
  vec2 uv = wp.xz * (0.085 - depth * 0.02) + vec2(wp.y * 0.01);
  vec2 q = mod(uv * 6.28318, 6.28318) - 250.0;
  float t = uTime * 0.45 + 23.0;
  float off = 0.012 + depth * 0.02;
  vec3 c = vec3(
    causticLayer(q + vec2(off, 0.0), t),
    causticLayer(q, t),
    causticLayer(q - vec2(off, 0.0), t)
  );
  float fade = (1.0 - uTurbidity * 0.85) * (1.0 - depth * 0.35);
  return c * fade;
}
`;

const VERT_DECL = `varying vec3 vWPos;\n`;
const VERT_POS = `
  {
    vec4 wp_ = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wp_ = instanceMatrix * wp_;
    #endif
    vWPos = (modelMatrix * wp_).xyz;
  }
`;

/**
 * Standart/fiziksel bir materyali sualtına uyarlar: kostik ışık + derinlikle
 * renk emilimi. `extra(shader)` ile ek değişiklik (yüzme, desen) yapılabilir.
 */
export function patchUnderwater(material, { key = 'uw', caustics = true, extra = null, uniforms = {} } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, WU, uniforms);
    shader.vertexShader = VERT_DECL + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n' + VERT_POS,
    );
    shader.fragmentShader = 'varying vec3 vWPos;\n' + WATER_GLSL + shader.fragmentShader;

    if (caustics) {
      const lights = THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= causticMul;',
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_begin>',
        `
        vec3 wN_ = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
        float up_ = clamp(wN_.y * 0.75 + 0.35, 0.0, 1.0);
        vec3 causticMul = vec3(0.5) + causticRGB(vWPos) * 1.9 * uCaustic * up_;
        if (vWPos.y > uBoxMax.y) causticMul = vec3(1.0);
        ` + lights,
      );
    }

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      '#include <opaque_fragment>\n gl_FragColor.rgb = applyWater(gl_FragColor.rgb, vWPos);',
    );

    if (extra) extra(shader);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

// ---------------------------------------------------------------------------
// Su hacmi: kutunun arka yüzleri çizilir. Önünde sualtı nesnesi olan yerlerde
// derinlik testi başarısız olur, böylece sis yalnızca "boş" su için eklenir.
export function createWaterVolume() {
  const inset = 0.05;
  const geo = new THREE.BoxGeometry(TANK.w - inset, TANK.water, TANK.d - inset);
  geo.translate(0, TANK.water / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: WU,
    vertexShader: /* glsl */ `
      varying vec3 vWPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWPos;
      ${WATER_GLSL}
      void main() {
        float d = waterPath(vWPos);
        vec3 T = exp(-waterSigma() * d);
        float a = 1.0 - dot(T, vec3(0.333));
        gl_FragColor = vec4(waterInscatter() * a, a);
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return mesh;
}

// ---------------------------------------------------------------------------
// Su yüzeyi
export const SURFACE_U = {
  uRipple: { value: new THREE.Vector4(0, 0, -100, 0) }, // x, z, başlangıç zamanı, güç
  uBubbleSrc: { value: new THREE.Vector3(22, -10, 1) },
};

export function createWaterSurface(refl) {
  const geo = new THREE.PlaneGeometry(TANK.w - 0.1, TANK.d - 0.1, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, TANK.water, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...WU, ...SURFACE_U, ...refl.uniforms },
    vertexShader: /* glsl */ `
      uniform mat4 uReflMat;
      varying vec3 vWPos;
      varying vec4 vReflUv;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vReflUv = uReflMat * wp;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWPos;
      varying vec4 vReflUv;
      uniform sampler2D tReflect;
      uniform float uReflOn;
      uniform vec4 uRipple;
      uniform vec3 uBubbleSrc;
      ${WATER_GLSL}

      vec2 waveGrad(vec2 p, float t) {
        vec2 g = vec2(0.0);
        // birkaç yönlü küçük dalga
        vec2 d1 = normalize(vec2(1.0, 0.3));  float f1 = dot(p, d1) * 0.9 + t * 1.6;
        vec2 d2 = normalize(vec2(-0.4, 1.0)); float f2 = dot(p, d2) * 1.3 + t * 2.1;
        vec2 d3 = normalize(vec2(0.7, -0.8)); float f3 = dot(p, d3) * 2.3 + t * 2.9;
        vec2 d4 = normalize(vec2(-1.0, -0.2)); float f4 = dot(p, d4) * 3.7 + t * 3.7;
        g += d1 * cos(f1) * 0.05 + d2 * cos(f2) * 0.04 + d3 * cos(f3) * 0.025 + d4 * cos(f4) * 0.018;
        // hava taşının yarattığı kıpırtı
        vec2 bp = p - uBubbleSrc.xy;
        float br = length(bp) + 1e-3;
        g += (bp / br) * cos(br * 2.4 - t * 9.0) * exp(-br * 0.18) * 0.22 * uBubbleSrc.z;
        // dokunma / yem dalgası
        float age = t - uRipple.z;
        if (age > 0.0 && age < 4.0) {
          vec2 rp = p - uRipple.xy;
          float rr = length(rp) + 1e-3;
          float front = age * 9.0;
          g += (rp / rr) * sin((rr - front) * 1.6) * exp(-abs(rr - front) * 0.5) * exp(-age * 0.9) * 0.35 * uRipple.w;
        }
        return g;
      }

      void main() {
        vec2 g = waveGrad(vWPos.xz, uTime);
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(cameraPosition - vWPos);
        bool fromAbove = cameraPosition.y > vWPos.y;
        vec3 lamp = uLampColor * (0.04 + uLamp);
        // dalga normaline göre bozulmuş gerçek yansıma
        vec2 ruv = vReflUv.xy / vReflUv.w + g * 0.22;
        vec3 mirror = texture2D(tReflect, clamp(ruv, 0.001, 0.999)).rgb;

        if (fromAbove) {
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
          vec3 R = reflect(-V, n);
          // basit oda yansıması: üstte lamba şeridi, çevrede loş oda
          vec3 env = mix(vec3(0.03, 0.028, 0.025), vec3(0.09, 0.08, 0.07), R.y);
          float strip = smoothstep(0.92, 0.99, R.y) * smoothstep(0.35, 0.05, abs(R.z));
          env += lamp * strip * 2.0;
          env = mix(env, mirror, uReflOn);
          vec3 H = normalize(V + vec3(0.0, 1.0, 0.15));
          float spec = pow(max(dot(n, H), 0.0), 220.0) * uLamp * 2.0;
          vec3 col = env * fres + spec * uLampColor;
          float a = clamp(fres * 0.9 + 0.08 + spec, 0.0, 1.0);
          gl_FragColor = vec4(col, a);
        } else {
          // Alttan: kritik açının dışında tam iç yansıma (ayna gibi parlak yüzey)
          vec3 nd = -n;
          float c = abs(dot(V, nd));
          float crit = 0.66; // cos(48.6°)
          vec3 under = waterInscatter() * 2.2;
          float tir = smoothstep(crit + 0.05, crit - 0.05, c);
          float sparkle = pow(max(0.0, 1.0 - length(g) * 6.0), 6.0);
          vec3 window = lamp * (0.65 + sparkle * 0.6);
          vec3 inside = mix(under, mirror * vec3(0.92, 0.97, 0.98), uReflOn) + lamp * 0.08 * sparkle;
          vec3 col = mix(window, inside, tir);
          // kameradan yüzeye kadar olan su katmanı
          float d = waterPath(vWPos);
          vec3 T = exp(-waterSigma() * d);
          col = col * T + waterInscatter() * (1.0 - T);
          float a = mix(0.55, mix(0.8, 0.96, uReflOn), tir);
          gl_FragColor = vec4(col, a);
        }
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 3;
  return mesh;
}

// Ön ve yan camda suyun bittiği parlak menisküs çizgisi
export function createMeniscus() {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: WU,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uLamp; uniform vec3 uLampColor; uniform float uTime;
      void main() {
        float band = exp(-pow((vUv.y - 0.5) * 5.0, 2.0));
        float wob = 0.85 + 0.15 * sin(vUv.x * 80.0 + uTime * 2.0);
        vec3 c = uLampColor * (0.08 + uLamp * 0.75) * band * wob;
        gl_FragColor = vec4(c, band * 0.9);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const h = 0.35;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(TANK.w, h), mat);
  front.position.set(0, TANK.water - 0.05, HALF_D - 0.02);
  const back = front.clone();
  back.position.z = -HALF_D + 0.02;
  back.rotation.y = Math.PI;
  const left = new THREE.Mesh(new THREE.PlaneGeometry(TANK.d, h), mat);
  left.position.set(-HALF_W + 0.02, TANK.water - 0.05, 0);
  left.rotation.y = Math.PI / 2;
  const right = left.clone();
  right.position.x = HALF_W - 0.02;
  right.rotation.y = -Math.PI / 2;
  group.add(front, back, left, right);
  group.renderOrder = 4;
  return group;
}

// ---------------------------------------------------------------------------
// Işık huzmeleri (god rays): yüzeyden aşağı süzülen, kameraya dönük şeritler
export function createGodRays(count = 9) {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1, 1, 1, 8);
  geo.translate(0, -0.5, 0);
  const rays = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...WU, uSeed: { value: Math.random() * 100 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWPos;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWPos;
        uniform float uSeed;
        ${WATER_GLSL}
        void main() {
          float edge = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
          edge = pow(edge, 1.6);
          float fall = pow(vUv.y, 1.3);
          float flick = 0.55 + 0.45 * sin(uTime * 0.7 + uSeed + vUv.x * 3.0) * sin(uTime * 0.43 + uSeed * 1.7);
          float strength = (0.05 + uTurbidity * 0.12) * uLamp * flick;
          vec3 c = uLampColor * strength * edge * fall;
          float d = waterPath(vWPos);
          c *= exp(-d * 0.01);
          gl_FragColor = vec4(c, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    const w = 2.5 + Math.random() * 5;
    const len = 18 + Math.random() * 14;
    m.scale.set(w, len, 1);
    m.position.set((Math.random() - 0.5) * (TANK.w - 10), TANK.water, (Math.random() - 0.5) * (TANK.d - 8));
    m.userData.tilt = (Math.random() - 0.5) * 0.25;
    m.userData.speed = 0.02 + Math.random() * 0.04;
    m.userData.base = m.position.x;
    m.renderOrder = 2;
    rays.push(m);
    group.add(m);
  }
  group.userData.update = (camera, t) => {
    for (const m of rays) {
      m.position.x = m.userData.base + Math.sin(t * m.userData.speed + m.userData.base) * 3;
      const dx = camera.position.x - m.position.x;
      const dz = camera.position.z - m.position.z;
      m.rotation.set(0, Math.atan2(dx, dz), m.userData.tilt);
    }
  };
  return group;
}
