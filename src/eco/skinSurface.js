import * as THREE from 'three';

// CPU contact for a skeletal mesh without morph targets. Cache one world-space
// matrix per bone per pose, instead of rebuilding four matrices for every vertex.
export class SkinSurface {
  constructor(mesh) {
    this.mesh = mesh;
    const a = mesh.geometry.attributes;
    this.count = a.position.count;
    this.positions = new Float64Array(this.count * 3);
    this.indices = new Uint16Array(this.count * 4);
    this.weights = new Float64Array(this.count * 4);
    for (let i = 0; i < this.count; i++) {
      for (let j = 0; j < 3; j++) this.positions[i * 3 + j] = a.position.getComponent(i, j);
      for (let j = 0; j < 4; j++) {
        this.indices[i * 4 + j] = a.skinIndex.getComponent(i, j);
        this.weights[i * 4 + j] = a.skinWeight.getComponent(i, j);
      }
    }
    this.palette = new Float64Array(mesh.skeleton.bones.length * 16);
    this.matrix = new THREE.Matrix4();
    this.worldBind = new THREE.Matrix4();
  }

  update() {
    const m = this.mesh, s = m.skeleton;
    this.worldBind.multiplyMatrices(m.matrixWorld, m.bindMatrixInverse);
    for (let b = 0; b < s.bones.length; b++) {
      this.matrix.multiplyMatrices(this.worldBind, s.bones[b].matrixWorld)
        .multiply(s.boneInverses[b]).multiply(m.bindMatrix);
      this.matrix.toArray(this.palette, b * 16);
    }
  }

  point(i, out) {
    const p = this.positions, w = this.weights, ids = this.indices, a = this.palette;
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    let px = 0, py = 0, pz = 0;
    for (let k = i * 4; k < i * 4 + 4; k++) {
      const weight = w[k];
      if (!weight) continue;
      const b = ids[k] * 16;
      px += (a[b] * x + a[b + 4] * y + a[b + 8] * z + a[b + 12]) * weight;
      py += (a[b + 1] * x + a[b + 5] * y + a[b + 9] * z + a[b + 13]) * weight;
      pz += (a[b + 2] * x + a[b + 6] * y + a[b + 10] * z + a[b + 14]) * weight;
    }
    return out.set(px, py, pz);
  }
}
