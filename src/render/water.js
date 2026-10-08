import * as THREE from 'three';
import { TANK, HALF_W, HALF_D } from '../config.js';

// Sualtındaki her materyalin paylaştığı uniform'lar. Tek yerden güncellenir.
export const WU = {
  uFlow: { value: 0.25 },
  uWake: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -100, 0, 0)) },
  uWakeVelocity: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
  uTime: { value: 0 },
  uLamp: { value: 1 },                                   // lamba yoğunluğu 0..1
  uLampColor: { value: new THREE.Color(1, 0.98, 0.94) },
  uAbsorb: { value: new THREE.Vector3(0.0065, 0.0024, 0.0021) }, // cm başına emilim (temiz su: kırmızıyı hafifçe yutar)
  uScatter: { value: new THREE.Color(0.05, 0.085, 0.1) },    // suyun kendi saçılma rengi
  uTurbidity: { value: 0 },                               // 0 berrak .. 1 çok bulanık
  uAlgae: { value: 0 },                                   // yeşillenme 0..1
  uCaustic: { value: 1 },
  uBoxMin: { value: new THREE.Vector3(-HALF_W, 0, -HALF_D) },
  uBoxMax: { value: new THREE.Vector3(HALF_W, TANK.water, HALF_D) },
  tCaustic: { value: null },                              // waterSim doldurur
  uCLight: { value: new THREE.Vector3(0, -1, 0) },        // düz yüzeyden kırılan ışık yönü
  uCRefY: { value: 3 },                                   // kostik düzleminin yüksekliği
  tHeight: { value: null },                               // yüzey yükseklik alanı (cm)
  uSimTexel: { value: new THREE.Vector2(1 / 256, 1 / 128) },
  uWaveAmp: { value: 1.25 },                               // sürekli yüzey kıpırtısı
};

export const WAVES_GLSL = /* glsl */ `
// Filtre akıntısının yüzeyde sürekli tuttuğu ince kılcal dalgalar (yükseklik, eğim x, eğim z)
vec3 baseWaves(vec2 p, float t, float amp) {
  vec3 r = vec3(0.0);
  float ph;
  #define W(kx, kz, w, a, o) ph = kx * p.x + kz * p.y - w * t + o; r += vec3(sin(ph), cos(ph) * kx, cos(ph) * kz) * a;
  W(2.8560, 0.0001, 26.8258, 0.0035, 1.9582);
  W(-1.8919, 1.6443, 24.0183, 0.0054, 2.5669);
  W(0.8488, -2.0296, 21.6638, 0.0046, 2.9672);
  W(0.9053, 1.7054, 19.6697, 0.0042, 4.4834);
  W(-1.6395, -0.4284, 17.9628, 0.0056, 3.6949);
  W(1.4830, -0.1120, 16.4852, 0.0064, 0.5320);
  W(-0.4931, 1.2086, 15.1917, 0.0096, 3.7217);
  W(-0.1747, -1.1322, 14.0474, 0.0090, 1.4753);
  W(0.8690, 0.5058, 13.0253, 0.0129, 0.0730);
  W(-0.8470, 0.2475, 12.1043, 0.0126, 4.4804);
  W(0.3272, -0.7020, 11.2684, 0.0123, 5.5729);
  W(0.0009, 0.6797, 10.5048, 0.0105, 3.8363);
  W(-0.2764, -0.5287, 9.8037, 0.0151, 5.6636);
  W(0.5112, -0.1131, 9.1573, 0.0235, 5.0770);
  #undef W
  return r * amp;
}
`;

// Shared current field: plants and loose food respond to the same circulation.
export function waterCurrent(p, time, strength, out) {
  return out.set(
    (0.35 * Math.sin(p.z / TANK.d * 6.283 + time * 0.23) + 0.12) * strength,
    0,
    0.22 * Math.cos(p.x / TANK.w * 6.283 + time * 0.19) * strength,
  );
}

// Apply in world space so rotated/scaled plants bend with the water together.
export function plantWaterMotion(shader, weight, floating = false) {
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
    uniform float uFlow;
    uniform vec4 uWake[8]; uniform vec3 uWakeVelocity[8];
    uniform vec3 uBoxMin, uBoxMax;
    ${floating ? 'uniform sampler2D tHeight; uniform float uWaveAmp;' + WAVES_GLSL : ''}`)
    .replace('#include <project_vertex>', `
      {
        mat4 waterModel = modelMatrix;
        #ifdef USE_INSTANCING
          waterModel = modelMatrix * instanceMatrix;
        #endif
        vec3 wp = (waterModel * vec4(transformed, 1.0)).xyz;
        vec2 extent = uBoxMax.xz - uBoxMin.xz;
        vec3 push = vec3(0.35 * sin(wp.z / extent.y * 6.283 + uTime * 0.23) + 0.12,
          0.0, 0.22 * cos(wp.x / extent.x * 6.283 + uTime * 0.19)) * uFlow;
        for (int i = 0; i < 8; i++) {
          vec3 delta = wp - uWake[i].xyz;
          float radius = max(1.0, uWake[i].w);
          float influence = exp(-dot(delta, delta) / (radius * radius));
          push += uWakeVelocity[i] * influence * 0.055;
        }
        push *= clamp(${weight}, 0.0, 1.0);
        ${floating ? 'push.y += (texture2D(tHeight, (wp.xz - uBoxMin.xz) / extent).r + baseWaves(wp.xz, uTime, uWaveAmp).x) * 0.85;' : ''}
        transformed += vec3(dot(push, waterModel[0].xyz) / max(dot(waterModel[0].xyz, waterModel[0].xyz), 0.0001),
          dot(push, waterModel[1].xyz) / max(dot(waterModel[1].xyz, waterModel[1].xyz), 0.0001),
          dot(push, waterModel[2].xyz) / max(dot(waterModel[2].xyz, waterModel[2].xyz), 0.0001));
      }
      #include <project_vertex>`);
}

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
uniform sampler2D tCaustic;
uniform vec3 uCLight;
uniform float uCRefY;
uniform sampler2D tHeight;
uniform vec2 uSimTexel;
uniform float uWaveAmp;
${WAVES_GLSL}

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
  // Bulanıklık (bakteri/atık) ışığı çoğunlukla saçar, renk ayırmadan söndürür;
  // yosun (yeşil su) ise kırmızı ve maviyi yutar.
  return uAbsorb + uTurbidity * vec3(0.022, 0.021, 0.02) + uAlgae * vec3(0.04, 0.01, 0.05);
}

vec3 waterInscatter() {
  vec3 milky = vec3(0.34, 0.37, 0.37);   // bakteri bulanıklığı: süt beyazı
  vec3 green = vec3(0.12, 0.24, 0.07);   // yeşil su
  float t = clamp(uTurbidity * 1.1, 0.0, 1.0);
  float g = clamp(uAlgae * 0.9, 0.0, 1.0);
  vec3 base = mix(mix(uScatter, milky, t), green, g);
  return base * (0.08 + uLamp * 0.92) * uLampColor;
}

vec3 applyWater(vec3 col, vec3 wp) {
  float d = waterPath(wp);
  vec3 T = exp(-waterSigma() * d);
  return col * T + waterInscatter() * (1.0 - T);
}

// Yüzeyin xz noktasındaki eğimi (dh/dx, dh/dz)
vec2 simSlope(vec2 xz) {
  vec2 size = uBoxMax.xz - uBoxMin.xz;
  vec2 uv = xz / size + 0.5;
  vec2 dx = vec2(uSimTexel.x, 0.0), dy = vec2(0.0, uSimTexel.y);
  vec2 cell = size * uSimTexel * 2.0;
  return vec2(
    (texture2D(tHeight, uv + dx).r - texture2D(tHeight, uv - dx).r) / cell.x,
    (texture2D(tHeight, uv + dy).r - texture2D(tHeight, uv - dy).r) / cell.y
  ) + baseWaves(xz, uTime, uWaveAmp).yz;
}

// Simüle edilen yüzeyden kırılan ışığın wp noktasındaki yoğunluğu (ortalama 1)
vec3 causticAt(vec3 wp) {
  if (wp.y > uBoxMax.y) return vec3(1.0);
  vec2 size = uBoxMax.xz - uBoxMin.xz;
  float t = (uCRefY - wp.y) / uCLight.y;
  vec2 uv = (wp.xz + uCLight.xz * t) / size + 0.5;
  float off = abs(wp.y - uCRefY);
  // geniş LED kaynağı: kostik düzleminden uzaklaştıkça yumuşar
  vec2 b = vec2(0.0012, 0.0024) * (1.0 + off * 0.35);
  vec2 ca = vec2(0.0009 + off * 0.00008, 0.0);
  vec3 c = vec3(
    texture2D(tCaustic, uv + ca).r,
    texture2D(tCaustic, uv).r,
    texture2D(tCaustic, uv - ca).r
  );
  float soft = 0.25 * (
    texture2D(tCaustic, uv + b).r + texture2D(tCaustic, uv - b).r +
    texture2D(tCaustic, uv + vec2(b.x, -b.y)).r + texture2D(tCaustic, uv + vec2(-b.x, b.y)).r);
  c = mix(c, vec3(soft), clamp(off / 14.0, 0.15, 0.75));
  // yüzeye yakın noktalarda ışık henüz odaklanmamıştır
  float focus = pow(clamp((uBoxMax.y - wp.y) / (uBoxMax.y - uCRefY), 0.0, 1.0), 0.65);
  return mix(vec3(1.0), c, focus * (1.0 - uTurbidity * 0.8));
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
        vec3 causticMul = mix(vec3(1.0), causticAt(vWPos), uCaustic * up_);
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
export function createWaterSurface(refl) {
  const geo = new THREE.PlaneGeometry(TANK.w - 0.1, TANK.d - 0.1, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, TANK.water, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...WU, ...refl.uniforms },
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
      ${WATER_GLSL}

      vec2 waveGrad(vec2 p, float t) {
        return simSlope(p);
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
          float strip = smoothstep(0.92, 0.99, R.y) * (1.0 - smoothstep(0.05, 0.35, abs(R.z)));
          env += lamp * strip * 2.0;
          env = mix(env, mirror, uReflOn);
          vec3 H = normalize(V + vec3(0.0, 1.0, 0.15));
          float spec = pow(max(dot(n, H), 0.0), 220.0) * uLamp * 2.0;
          vec3 col = env * fres + spec * uLampColor;
          float a = clamp(fres * 0.9 + 0.08 + spec, 0.0, 1.0);
          gl_FragColor = vec4(col / max(a, 0.0001), a);
        } else {
          // Alttan: kritik açının dışında tam iç yansıma (ayna gibi parlak yüzey)
          vec3 nd = -n;
          float c = abs(dot(V, nd));
          float crit = 0.66; // cos(48.6°)
          vec3 under = waterInscatter() * 2.2;
          float tir = (1.0 - smoothstep(crit - 0.05, crit + 0.05, c));
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
          float beam = causticAt(vWPos).g;
          vec3 c = uLampColor * strength * edge * fall * (0.35 + beam * 0.9);
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
