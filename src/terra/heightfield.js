import * as THREE from 'three';

// Görünen yüzeyden yükseklik haritası: yürünebilir modeller (zemin, yosun, yaprak, mantar)
// yukarıdan dik izdüşümle bir kez çizilir, her pikselin dünya yüksekliği okunur.
// Böylece fizik zemini ekrandaki zeminle birebir aynı olur.
function heightMaterial(src) {
  const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  if (src?.map && src.alphaTest > 0) { m.map = src.map; m.alphaTest = src.alphaTest; }
  const extra = src?.userData?.heightDiscard ?? '';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWy;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
          #endif
          vWy = (modelMatrix * wp).y; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWy;')
      .replace('#include <alphatest_fragment>', `${extra}\n#include <alphatest_fragment>`)
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor = vec4(vWy, 0.0, 0.0, 1.0);');
  };
  return m;
}

export function bakeHeightfield(renderer, objects, { w, d, top, res = 0.125 }) {
  const nx = Math.round(w / res), nz = Math.round(d / res);
  const rt = new THREE.WebGLRenderTarget(nx, nz, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
  rt.texture.colorSpace = THREE.NoColorSpace;
  // görüntünün üstü -z: satır j → z = -d/2 + (j + .5) * res, sütun i → x = -w/2 + (i + .5) * res
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0.1, top + 20);
  cam.position.set(0, top + 10, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);

  const scene = new THREE.Scene();
  const swaps = [];
  for (const root of objects) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const h = heightMaterial(mats[0]);
      const proxy = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, h, o.count) : new THREE.Mesh(o.geometry, h);
      if (o.isInstancedMesh) { proxy.instanceMatrix = o.instanceMatrix; proxy.count = o.count; }
      proxy.matrixAutoUpdate = false;
      proxy.matrix.copy(o.matrixWorld);
      proxy.matrixWorld.copy(o.matrixWorld);
      proxy.frustumCulled = false;
      scene.add(proxy);
      swaps.push(h);
    });
  }
  const prevRT = renderer.getRenderTarget();
  scene.matrixWorldAutoUpdate = false;
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Float32Array(nx * nz * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, nx, nz, px);
  renderer.setRenderTarget(prevRT);
  rt.dispose();
  swaps.forEach((m) => m.dispose());

  // readPixels satırları alttan başlar: alt satır = görüntünün altı = +z
  const H = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = px[((nz - 1 - j) * nx + i) * 4];
  return new Heightfield(H, nx, nz, w, d, res);
}

export class Heightfield {
  constructor(H, nx, nz, w, d, res) {
    Object.assign(this, { H, nx, nz, w, d, res });
    // dik yüzey haritası: ~1 cm içinde 1.3 cm'den fazla yükselen yer duvar sayılır (semender tırmanamaz)
    const k = Math.max(1, Math.round(0.6 / res));
    this.steep = new Uint8Array(nx * nz);
    this.gx = new Float32Array(nx * nz);
    this.gz = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = this.cell(i - k, j), b = this.cell(i + k, j), c = this.cell(i, j - k), e = this.cell(i, j + k);
      const gx = (b - a) / (2 * k * res), gz = (e - c) / (2 * k * res);
      const n = j * nx + i;
      this.gx[n] = gx; this.gz[n] = gz;
      this.steep[n] = Math.hypot(gx, gz) > 1.3 ? 1 : 0;
    }
  }
  cell(i, j) {
    i = Math.min(this.nx - 1, Math.max(0, i)); j = Math.min(this.nz - 1, Math.max(0, j));
    return this.H[j * this.nx + i];
  }
  idx(x, z) {
    return [(x + this.w / 2) / this.res - 0.5, (z + this.d / 2) / this.res - 0.5];
  }
  // bilineer yükseklik
  at(x, z) {
    const [fx, fz] = this.idx(x, z);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = this.cell(i, j), b = this.cell(i + 1, j), c = this.cell(i, j + 1), e = this.cell(i + 1, j + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
  }
  normal(x, z, out = new THREE.Vector3(), s = 0.25) {
    const gx = (this.at(x + s, z) - this.at(x - s, z)) / (2 * s), gz = (this.at(x, z + s) - this.at(x, z - s)) / (2 * s);
    return out.set(-gx, 1, -gz).normalize();
  }
  isSteep(x, z) {
    const [fx, fz] = this.idx(x, z);
    const i = Math.round(fx), j = Math.round(fz);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return true;
    return this.steep[j * this.nx + i] === 1;
  }
  // duvardan uzaklaşma yönü (yokuş aşağı)
  grad(x, z) {
    const [fx, fz] = this.idx(x, z);
    const n = Math.min(this.nz - 1, Math.max(0, Math.round(fz))) * this.nx + Math.min(this.nx - 1, Math.max(0, Math.round(fx)));
    return [this.gx[n], this.gz[n]];
  }
}
