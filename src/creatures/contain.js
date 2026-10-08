import * as THREE from 'three';
import { TANK, HALF_W, HALF_D } from '../config.js';

const _b = new THREE.Box3();

// Grubun dünya kutusu camı ya da su yüzeyini aşıyorsa konumu içeri kaydırır (yüzgeç, anten, kabuk dahil)
export function containGroup(group, pos, margin = 0.2) {
  group.updateMatrixWorld(true);
  _b.setFromObject(group);
  const dx = Math.max(0, -HALF_W + margin - _b.min.x) - Math.max(0, _b.max.x - (HALF_W - margin));
  const dz = Math.max(0, -HALF_D + margin - _b.min.z) - Math.max(0, _b.max.z - (HALF_D - margin));
  const dy = -Math.max(0, _b.max.y - (TANK.water - 0.1));
  if (!dx && !dz && !dy) return;
  pos.x += dx; pos.y += dy; pos.z += dz;
  group.position.copy(pos);
}
