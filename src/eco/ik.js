import * as THREE from 'three';

// Ters kinematik yardımcıları: kemiklere dünya uzayında dönme uygular.
const _pq = new THREE.Quaternion(), _bq = new THREE.Quaternion(), _q = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _ab = new THREE.Vector3(), _bc = new THREE.Vector3(), _n = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();

export function worldRotate(bone, q) {
  bone.parent.getWorldQuaternion(_pq);
  _bq.copy(_pq).multiply(bone.quaternion).premultiply(q);
  bone.quaternion.copy(_pq.invert().multiply(_bq));
  bone.updateMatrixWorld(true);
}

// İki kemikli zincir (üst kol, ön kol) ucunu hedefe götürür; dirsek mevcut büküm düzleminde kalır.
export function twoBoneIK(upper, lower, end, target, pole) {
  upper.getWorldPosition(_a); lower.getWorldPosition(_b); end.getWorldPosition(_c);
  const la = _a.distanceTo(_b), lb = _b.distanceTo(_c);
  const d = THREE.MathUtils.clamp(_a.distanceTo(target), Math.abs(la - lb) + 1e-3, (la + lb) * 0.999);
  _ab.subVectors(_b, _a).normalize();
  _bc.subVectors(_c, _b).normalize();
  _n.crossVectors(_ab, _bc);
  if (_n.lengthSq() < 1e-8) _n.crossVectors(_ab, pole ?? _w.set(0, 1, 0));
  _n.normalize();
  const bendNow = Math.acos(THREE.MathUtils.clamp(_ab.dot(_bc), -1, 1));
  const bendWant = Math.PI - Math.acos(THREE.MathUtils.clamp((la * la + lb * lb - d * d) / (2 * la * lb), -1, 1));
  _q.setFromAxisAngle(_n, bendWant - bendNow);
  worldRotate(lower, _q);
  end.getWorldPosition(_c);
  _u.subVectors(_c, _a).normalize();
  _w.subVectors(target, _a).normalize();
  _q.setFromUnitVectors(_u, _w);
  worldRotate(upper, _q);
}

// Parmak/ayak tabanını zemine yatır: bir kemiği uç noktası yerden r yüksekte olacak şekilde döndür.
export function dropToGround(bone, tip, groundAt, r, max = 0.8) {
  bone.getWorldPosition(_a);
  _u.subVectors(tip, _a);
  const L = _u.length();
  if (L < 1e-4) return;
  const eNow = Math.asin(THREE.MathUtils.clamp(_u.y / L, -1, 1));
  const eWant = Math.asin(THREE.MathUtils.clamp((groundAt(tip.x, tip.z) + r - _a.y) / L, -1, 1));
  _n.crossVectors(_u, _w.set(0, 1, 0));
  if (_n.lengthSq() < 1e-8) return;
  _q.setFromAxisAngle(_n.normalize(), THREE.MathUtils.clamp(eWant - eNow, -max, max));
  worldRotate(bone, _q);
}
