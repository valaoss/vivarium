import * as THREE from 'three';
import { TANK, HALF_W, HALF_D, MOBILE } from '../config.js';
import { WU, WAVES_GLSL } from './water.js';

/*
 * Su yüzeyi dalga simülasyonu (GPU'da yükseklik alanı) ve bu yüzeyden
 * kırılan lamba ışığının tabanda oluşturduğu kostik desen.
 * Yükseklik cm cinsinden; R = yükseklik, G = hız. Kenarlar camdan yansır.
 */

const MAX_DROPS = 8;
const STEP_HZ = 120;
const IOR = 1 / 1.333;
const REF_Y = 3; // kostiğin hesaplandığı düzlem (kum seviyesi)

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const STEP_FRAG = /* glsl */ `
  uniform sampler2D tPrev;
  uniform vec2 uTexel;
  uniform vec2 uWorld;
  uniform float uDamp;
  uniform vec4 uDrops[${MAX_DROPS}];
  uniform int uDropCount;
  varying vec2 vUv;
  void main() {
    vec4 s = texture2D(tPrev, vUv);
    vec2 dx = vec2(uTexel.x, 0.0), dy = vec2(0.0, uTexel.y);
    float avg = (texture2D(tPrev, vUv - dx).r + texture2D(tPrev, vUv + dx).r
               + texture2D(tPrev, vUv - dy).r + texture2D(tPrev, vUv + dy).r) * 0.25;
    s.g += (avg - s.r) * 2.0;
    s.g *= uDamp;
    s.r += s.g;
    s.r *= 0.9992;
    vec2 p = (vUv - 0.5) * uWorld;
    for (int i = 0; i < ${MAX_DROPS}; i++) {
      if (i >= uDropCount) break;
      vec4 d = uDrops[i];
      float k = max(0.0, 1.0 - length(p - d.xy) / d.z);
      s.r += (0.5 - cos(k * 3.14159265) * 0.5) * d.w;
    }
    gl_FragColor = s;
  }`;

const CAUSTIC_VERT = /* glsl */ `
  uniform sampler2D tHeight;
  uniform vec2 uTexel;
  uniform vec2 uWorld;
  uniform vec3 uLight;
  uniform float uDepth;
  uniform float uTime;
  uniform float uWaveAmp;
  varying vec2 vOld;
  varying vec2 vNew;
  ${WAVES_GLSL}
  void main() {
    vec2 dx = vec2(uTexel.x, 0.0), dy = vec2(0.0, uTexel.y);
    vec2 cell = uWorld * uTexel * 2.0;
    vec2 p = (uv - 0.5) * uWorld;
    vec3 bw = baseWaves(p, uTime, uWaveAmp);
    float hL = texture2D(tHeight, uv - dx).r, hR = texture2D(tHeight, uv + dx).r;
    float hD = texture2D(tHeight, uv - dy).r, hU = texture2D(tHeight, uv + dy).r;
    vec3 n = normalize(vec3(-(hR - hL) / cell.x - bw.y, 1.0, -(hU - hD) / cell.y - bw.z));
    float h = texture2D(tHeight, uv).r + bw.x;
    vec3 rFlat = refract(-uLight, vec3(0.0, 1.0, 0.0), ${IOR.toFixed(5)});
    vec3 r = refract(-uLight, n, ${IOR.toFixed(5)});
    vOld = p + rFlat.xz * (uDepth / -rFlat.y);
    vNew = p + r.xz * ((uDepth + h) / -r.y);
    gl_Position = vec4(vNew / (uWorld * 0.5), 0.0, 1.0);
  }`;

const CAUSTIC_FRAG = /* glsl */ `
  varying vec2 vOld;
  varying vec2 vNew;
  void main() {
    float oldA = length(dFdx(vOld)) * length(dFdy(vOld));
    float newA = length(dFdx(vNew)) * length(dFdy(vNew));
    gl_FragColor = vec4(min(oldA / max(newA, 1e-7), 8.0), 0.0, 0.0, 1.0);
  }`;

export class WaterSim {
  constructor(renderer, { lightDir = new THREE.Vector3(2, 90, 8) } = {}) {
    this.renderer = renderer;
    const W = MOBILE ? 192 : 256;
    const H = W / 2;
    const rt = () => new THREE.WebGLRenderTarget(W, H, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
    });
    this.rts = [rt(), rt()];
    this.cur = 0;
    this.world = new THREE.Vector2(TANK.w, TANK.d);
    this.texel = new THREE.Vector2(1 / W, 1 / H);

    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.drops = [];
    this.dropU = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4());
    this.stepMat = new THREE.ShaderMaterial({
      uniforms: {
        tPrev: { value: null },
        uTexel: { value: this.texel },
        uWorld: { value: this.world },
        uDamp: { value: 0.994 },
        uDrops: { value: this.dropU },
        uDropCount: { value: 0 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: STEP_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.stepMat);
    quad.frustumCulled = false;
    this.quadScene.add(quad);

    const CW = MOBILE ? 256 : 512;
    this.causticRT = new THREE.WebGLRenderTarget(CW, CW / 2, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    const segX = MOBILE ? 160 : 256;
    this.light = lightDir.clone().normalize();
    this.causticMat = new THREE.ShaderMaterial({
      uniforms: {
        tHeight: { value: null },
        uTexel: { value: this.texel },
        uWorld: { value: this.world },
        uLight: { value: this.light },
        uDepth: { value: TANK.water - REF_Y },
        uTime: WU.uTime,
        uWaveAmp: WU.uWaveAmp,
      },
      vertexShader: CAUSTIC_VERT,
      fragmentShader: CAUSTIC_FRAG,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.causticScene = new THREE.Scene();
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, segX, segX / 2), this.causticMat);
    grid.frustumCulled = false;
    this.causticScene.add(grid);

    const rFlat = refractVec(this.light.clone().negate(), new THREE.Vector3(0, 1, 0), IOR);
    WU.tCaustic.value = this.causticRT.texture;
    WU.uCLight.value.copy(rFlat);
    WU.uCRefY.value = REF_Y;
    WU.tHeight.value = this.rts[0].texture;
    WU.uSimTexel.value.copy(this.texel);

    this.acc = 0;
    this.gain = 6;
    this.sources = { filter: null, filterK: 1 };
    this._clear = new THREE.Color();
    this.clearAll();
  }

  clearAll() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.getClearColor(this._clear);
    const a = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const t of this.rts) { r.setRenderTarget(t); r.clear(); }
    r.setRenderTarget(prev);
    r.setClearColor(this._clear, a);
  }

  /** Yüzeye bir damla/itme ekler. x,z dünya cm; r yarıçap cm; s yükseklik cm (eksi = çukur). */
  drop(x, z, r, s) {
    if (Math.abs(x) > HALF_W || Math.abs(z) > HALF_D) return;
    if (this.drops.length < 64) this.drops.push([x, z, r, s * this.gain]);
  }

  /** Kendiliğinden oluşan kıpırtılar: filtre çıkışı, hava taşı, odadaki hafif hava akımı */
  ambient(dt) {
    const rnd = Math.random;
    const poisson = (rate, fn) => { let n = rate * dt; while (n > 0) { if (rnd() < n) fn(); n -= 1; } };
    const f = this.sources.filter;
    if (f) {
      poisson(40 * this.sources.filterK, () => {
        const a = rnd();
        this.drop(f.x + 1 + a * 12 + (rnd() - 0.5) * 3, f.z + 1 + a * 6 * rnd(), 0.6 + rnd() * 1.4, (rnd() - 0.45) * 0.03 * (1 - a * 0.6));
      });
    }
    // filtrenin yarattığı genel akıntı yüzeyi hiç tam durgun bırakmaz
    poisson(18, () => {
      this.drop((rnd() - 0.5) * TANK.w, (rnd() - 0.5) * TANK.d, 0.7 + rnd() * 1.6, (rnd() - 0.5) * 0.006);
    });
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    this.ambient(dt);
    this.acc += dt;
    const steps = Math.min(4, Math.floor(this.acc * STEP_HZ));
    this.acc -= steps / STEP_HZ;
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    for (let i = 0; i < steps; i++) {
      const chunk = this.drops.splice(0, MAX_DROPS);
      for (let k = 0; k < chunk.length; k++) this.dropU[k].set(...chunk[k]);
      this.stepMat.uniforms.uDropCount.value = chunk.length;
      this.stepMat.uniforms.tPrev.value = this.rts[this.cur].texture;
      this.cur ^= 1;
      r.setRenderTarget(this.rts[this.cur]);
      r.render(this.quadScene, this.cam);
    }
    this.drops.length = 0;
    const height = this.rts[this.cur].texture;
    WU.tHeight.value = height;

    this.causticMat.uniforms.tHeight.value = height;
    r.getClearColor(this._clear);
    const a = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.causticRT);
    r.clear();
    r.render(this.causticScene, this.cam);
    r.setClearColor(this._clear, a);
    r.setRenderTarget(prevRT);
    r.autoClear = prevAuto;
  }
}

function refractVec(I, N, eta) {
  const d = N.dot(I);
  const k = 1 - eta * eta * (1 - d * d);
  return I.clone().multiplyScalar(eta).sub(N.clone().multiplyScalar(eta * d + Math.sqrt(k))).normalize();
}
