import { Vector3 } from 'three';

const center = new Vector3();

// Preserve GPU buffers, UVs and indices while a flexible hose changes shape.
export function updateTubeGeometry(geometry, curve) {
  const { tubularSegments: segments, radialSegments: sides, radius, closed } = geometry.parameters;
  const frames = curve.computeFrenetFrames(segments, closed);
  const { position, normal } = geometry.attributes;
  for (let i = 0; i <= segments; i++) {
    curve.getPointAt(i / segments, center);
    const n = frames.normals[i], b = frames.binormals[i];
    for (let j = 0; j <= sides; j++) {
      const angle = j / sides * Math.PI * 2;
      const c = -Math.cos(angle), sn = Math.sin(angle);
      const nx = c * n.x + sn * b.x, ny = c * n.y + sn * b.y, nz = c * n.z + sn * b.z;
      const k = i * (sides + 1) + j;
      normal.setXYZ(k, nx, ny, nz);
      position.setXYZ(k, center.x + nx * radius, center.y + ny * radius, center.z + nz * radius);
    }
  }
  position.needsUpdate = normal.needsUpdate = true;
  geometry.computeBoundingSphere();
}
