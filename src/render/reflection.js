import * as THREE from 'three';

/*
 * Yatay su yüzeyi için düzlemsel yansıma (three.js Reflector mantığı).
 * Kamera suyun altındaysa normal aşağı bakar: yüzeyin alt tarafı tankın içini
 * (tam iç yansıma) gösterir. Üstündeyse lamba ve oda yansır.
 * Eğik yakın-düzlem kırpma ile yalnızca düzlemin kamera tarafındaki nesneler çizilir.
 */
export class PlanarReflection {
  constructor(renderer, scene, height, { scale = 0.4, clipBias = 0.003 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.height = height;
    this.scale = scale;
    this.clipBias = clipBias;
    this.hidden = [];
    this.frames = 0;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.enableAll();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(Math.max(1, size.x * scale), Math.max(1, size.y * scale), {
      type: THREE.HalfFloatType,
    });
    this.textureMatrix = new THREE.Matrix4();
    this.uniforms = {
      tReflect: { value: this.target.texture },
      uReflMat: { value: this.textureMatrix },
      uReflOn: { value: 1 },
    };
    this._n = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._view = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._rot = new THREE.Matrix4();
    this._plane = new THREE.Plane();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
  }

  /** Yansıma çizilirken gizlenecek nesneler (yüzeyin kendisi, menisküs vb.) */
  hide(...objs) { this.hidden.push(...objs); }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.target.setSize(Math.max(1, w * pr * this.scale), Math.max(1, h * pr * this.scale));
  }

  update(camera) {
    const { renderer, scene } = this;
    if (!this.uniforms.uReflOn.value) return;
    const cam = this.camera;
    const camPos = this._p.setFromMatrixPosition(camera.matrixWorld);
    const below = camPos.y < this.height;
    const normal = this._n.set(0, below ? -1 : 1, 0);
    const origin = new THREE.Vector3(0, this.height, 0);

    const view = this._view.subVectors(origin, camPos).reflect(normal).negate().add(origin);
    this._rot.extractRotation(camera.matrixWorld);
    const look = this._look.set(0, 0, -1).applyMatrix4(this._rot).add(camPos);
    const target = this._target.subVectors(origin, look).reflect(normal).negate().add(origin);

    cam.position.copy(view);
    cam.up.set(0, 1, 0).applyMatrix4(this._rot).reflect(normal);
    cam.lookAt(target);
    cam.near = camera.near;
    cam.far = camera.far;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(
      0.5, 0, 0, 0.5,
      0, 0.5, 0, 0.5,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1,
    );
    this.textureMatrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    // Eğik kırpma düzlemi
    this._plane.setFromNormalAndCoplanarPoint(normal, origin).applyMatrix4(cam.matrixWorldInverse);
    const clip = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const pm = cam.projectionMatrix;
    const q = this._q;
    q.x = (Math.sign(clip.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(clip.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1;
    q.w = (1 + pm.elements[10]) / pm.elements[14];
    clip.multiplyScalar(2 / clip.dot(q));
    pm.elements[2] = clip.x;
    pm.elements[6] = clip.y;
    pm.elements[10] = clip.z + 1 - this.clipBias;
    pm.elements[14] = clip.w;
    cam.projectionMatrixInverse.copy(pm).invert();

    const vis = this.hidden.map((o) => o.visible);
    for (const o of this.hidden) o.visible = false;
    const prevTarget = renderer.getRenderTarget();
    // Gölge haritası ana çizimde zaten güncelleniyor; ilk kareler (programlar
    // derlenirken) geçtikten sonra ikinci kez hesaplanmasın.
    const prevShadow = renderer.shadowMap.autoUpdate;
    if (++this.frames > 3) renderer.shadowMap.autoUpdate = false;
    try {
      renderer.setRenderTarget(this.target);
      renderer.state.buffers.depth.setMask(true);
      renderer.clear();
      renderer.render(scene, cam);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.shadowMap.autoUpdate = prevShadow;
      this.hidden.forEach((o, i) => { o.visible = vis[i]; });
    }
  }
}

/*
 * Dikey cam panellerde tam iç yansıma (TIR) için genel düzlem aynası.
 * Yalnızca tankın içi düşük çözünürlükte çizilir.
 */
export class PlaneMirror {
  constructor(renderer, scene, { scale = 0.3, clipBias = 0.003 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.scale = scale;
    this.clipBias = clipBias;
    this.hidden = [];
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.enableAll();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(Math.max(1, size.x * scale), Math.max(1, size.y * scale), { type: THREE.HalfFloatType });
    this.textureMatrix = new THREE.Matrix4();
    this.normal = new THREE.Vector3();
    this.point = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._rot = new THREE.Matrix4();
    this._plane = new THREE.Plane();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
  }

  hide(...objs) { this.hidden.push(...objs); }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.target.setSize(Math.max(1, w * pr * this.scale), Math.max(1, h * pr * this.scale));
  }

  /** normal: aynanın yansıttığı tarafa (tankın içine) bakan birim vektör */
  update(camera, normal, point) {
    const { renderer, scene } = this;
    this.normal.copy(normal);
    this.point.copy(point);
    const cam = this.camera;
    const camPos = this._p.setFromMatrixPosition(camera.matrixWorld);
    // Aynalanmış kamera: düzlemin öbür yanında
    const view = point.clone().sub(camPos).reflect(normal).negate().add(point);
    this._rot.extractRotation(camera.matrixWorld);
    const look = this._look.set(0, 0, -1).applyMatrix4(this._rot).add(camPos);
    const target = this._target.subVectors(point, look).reflect(normal).negate().add(point);
    // Kamera düzlemin içteki tarafındaysa tersine çevir
    const side = Math.sign(camPos.clone().sub(point).dot(normal)) || 1;
    const n = normal.clone().multiplyScalar(side);
    cam.position.copy(view);
    cam.up.set(0, 1, 0).applyMatrix4(this._rot).reflect(n);
    cam.lookAt(target);
    cam.near = camera.near;
    cam.far = camera.far;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    // Yalnızca aynanın iç tarafındaki nesneler: eğik yakın-düzlem kırpma
    this._plane.setFromNormalAndCoplanarPoint(normal.clone().multiplyScalar(-side).negate(), point).applyMatrix4(cam.matrixWorldInverse);
    const clip = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const pm = cam.projectionMatrix;
    const q = this._q;
    q.x = (Math.sign(clip.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(clip.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1;
    q.w = (1 + pm.elements[10]) / pm.elements[14];
    clip.multiplyScalar(2 / clip.dot(q));
    pm.elements[2] = clip.x;
    pm.elements[6] = clip.y;
    pm.elements[10] = clip.z + 1 - this.clipBias;
    pm.elements[14] = clip.w;
    cam.projectionMatrixInverse.copy(pm).invert();

    const vis = this.hidden.map((o) => o.visible);
    for (const o of this.hidden) o.visible = false;
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    try {
      renderer.setRenderTarget(this.target);
      renderer.state.buffers.depth.setMask(true);
      renderer.clear();
      renderer.render(scene, cam);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.shadowMap.autoUpdate = prevShadow;
      this.hidden.forEach((o, i) => { o.visible = vis[i]; });
    }
  }
}
