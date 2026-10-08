import * as THREE from 'three';

// Köpük yuvası: erkek beta / gurami yüzeyin hemen altına salgıyla kaplı kabarcıklar üfler.
// Kabarcıklar bir sal gibi kümelenir, zamanla tek tek söner; akıntı varsa dağılır.
const MAX = 260;

export function createBubbleNest(waterY) {
  const geo = new THREE.SphereGeometry(1, 10, 8);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.35,
    clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false, envMapIntensity: 2,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  const B = [];          // { x, z, r, life, age }
  const m4 = new THREE.Matrix4();
  let y = waterY;
  return {
    mesh,
    get size() { return B.length; },
    setWater(v) { y = v; },
    // yuva merkezine yakın, mevcut kabarcıkların kenarına yeni kabarcık
    add(cx, cz) {
      if (B.length >= MAX) return;
      const a = Math.random() * Math.PI * 2, spread = 0.4 + Math.sqrt(B.length) * 0.22;
      B.push({ x: cx + Math.cos(a) * spread * Math.random(), z: cz + Math.sin(a) * spread * Math.random(), r: 0.06 + Math.random() * 0.1, life: 900 + Math.random() * 1500, age: 0 });
    },
    update(dt, flow) {
      for (let i = B.length - 1; i >= 0; i--) {
        const b = B[i];
        b.age += dt * (1 + flow * 4);
        if (flow > 0.4) { b.x += (Math.random() - 0.5) * dt * flow; b.z += (Math.random() - 0.5) * dt * flow; }
        if (b.age > b.life) B.splice(i, 1);
      }
      for (let i = 0; i < B.length; i++) {
        const b = B[i];
        const r = b.r * Math.min(1, b.age * 2) * (b.age > b.life - 20 ? (b.life - b.age) / 20 : 1);
        m4.makeScale(r, r * 0.8, r).setPosition(b.x, y - r * 0.55, b.z);
        mesh.setMatrixAt(i, m4);
      }
      mesh.count = B.length;
      mesh.instanceMatrix.needsUpdate = true;
    },
    serialize() { return B.length ? { n: B.length, x: B[0].x, z: B[0].z } : null; },
  };
}
