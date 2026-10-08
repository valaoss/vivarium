import * as THREE from 'three';
import { TANK, HALF_W, HALF_D } from '../config.js';
import { sandHeight } from './substrate.js';

// Su değişimi gereçleri: dip sifonu (şeffaf boru + hortum + kova) ve dolum sürahisi.
// Hepsi tankın camlarına, lambaya ve dolaba girmeyecek şekilde konumlanır.

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

export function createSiphon(floorY) {
  const group = new THREE.Group();
  group.visible = false;
  // dip sifonu borusu: şeffaf sert plastik
  const tubeMat = new THREE.MeshPhysicalMaterial({ color: 0xe8f4f2, roughness: 0.08, transparent: true, opacity: 0.28, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1, 28, 1, true), tubeMat);
  tube.renderOrder = 7;
  group.add(tube);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x2b3a3c, roughness: 0.5 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.18, 8, 28), rimMat);
  group.add(rim);
  // borunun içinde akan su + sürüklenen tortu (akarken koyulaşır)
  const flowMat = new THREE.MeshBasicMaterial({ color: 0x5a5236, transparent: true, opacity: 0, depthWrite: false });
  const flow = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 1, 20, 1, true), flowMat);
  flow.renderOrder = 6;
  group.add(flow);
  // üstte hortum bağlantısı
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 0.7, 2.2, 24), new THREE.MeshStandardMaterial({ color: 0x223033, roughness: 0.4 }));
  group.add(cap);
  // esnek hortum (yarı saydam yeşilimsi PVC)
  const hoseMat = new THREE.MeshPhysicalMaterial({ color: 0x9fc4b2, roughness: 0.25, transparent: true, opacity: 0.55, clearcoat: 0.6, depthWrite: false });
  const hose = new THREE.Mesh(new THREE.BufferGeometry(), hoseMat);
  hose.renderOrder = 7;
  group.add(hose);
  // kova: zeminde, dolabın önünde
  const bucket = new THREE.Group();
  const bMat = new THREE.MeshStandardMaterial({ color: 0x3d6f8f, roughness: 0.55, side: THREE.DoubleSide });
  const bBody = new THREE.Mesh(new THREE.CylinderGeometry(13, 11, 26, 40, 1, true), bMat);
  bBody.position.y = 13;
  const bBottom = new THREE.Mesh(new THREE.CircleGeometry(11, 40), bMat);
  bBottom.rotation.x = -Math.PI / 2;
  bBottom.position.y = 0.3;
  const bWater = new THREE.Mesh(new THREE.CircleGeometry(11.2, 40), new THREE.MeshStandardMaterial({ color: 0x4a4a32, roughness: 0.08, metalness: 0.1 }));
  bWater.rotation.x = -Math.PI / 2;
  bWater.position.y = 0.6;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(13.2, 0.3, 6, 40, Math.PI), new THREE.MeshStandardMaterial({ color: 0x8a8f94, metalness: 0.8, roughness: 0.35 }));
  handle.position.y = 26;
  handle.rotation.z = -0.3;
  bucket.add(bBody, bBottom, bWater, handle);
  const bucketPos = new THREE.Vector3(HALF_W * 0.55, floorY, HALF_D + 26);
  bucket.position.copy(bucketPos);
  group.add(bucket);
  // tortu parçacıkları: ağızdan emilip boruda yükselir
  const N = 160;
  const dGeo = new THREE.BufferGeometry();
  const dPos = new Float32Array(N * 3), dT = new Float32Array(N).fill(-1), dOff = new Float32Array(N * 2);
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  const debris = new THREE.Points(dGeo, new THREE.PointsMaterial({ color: 0x6b5a3a, size: 0.22, transparent: true, opacity: 0.85, depthWrite: false }));
  debris.frustumCulled = false;
  group.add(debris);

  const tip = new THREE.Vector3(), top = new THREE.Vector3();
  let lastKey = '';

  function setPose(x, z) {
    // ağız kumun hemen üstünde; boru öne doğru eğilip lambanın önünden cam kenarının üstüne çıkar
    tip.set(x, sandHeight(x, z) + 0.5, z);
    const zTop = THREE.MathUtils.clamp(z + 6, 8.4, HALF_D - 2);
    top.set(x * 0.92, TANK.h + 3.2, zTop);
    const len = tip.distanceTo(top);
    _a.subVectors(top, tip).normalize();
    _q.setFromUnitVectors(_up, _a);
    for (const m of [tube, flow]) {
      m.position.lerpVectors(tip, top, 0.5);
      m.quaternion.copy(_q);
      m.scale.set(1, len, 1);
    }
    rim.position.copy(tip);
    rim.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    cap.position.copy(top).addScaledVector(_a, 1.0);
    cap.quaternion.copy(_q);
    // hortum: bağlantıdan cam kenarının üstünden dışarı, dolabın önünden kovaya
    const key = `${top.x.toFixed(1)},${top.z.toFixed(1)}`;
    if (key !== lastKey) {
      lastKey = key;
      const s = cap.position.clone().addScaledVector(_a, 1.0);
      const pts = [
        s,
        new THREE.Vector3(s.x, TANK.h + 6, HALF_D + 1.5),
        new THREE.Vector3(s.x + 1, TANK.h + 2, HALF_D + 7),
        new THREE.Vector3((s.x + bucketPos.x) / 2, -8, HALF_D + 9),
        new THREE.Vector3(bucketPos.x - 4, floorY + 40, bucketPos.z - 6),
        new THREE.Vector3(bucketPos.x - 3, floorY + 22, bucketPos.z - 3),
      ];
      hose.geometry.dispose();
      hose.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 90, 0.65, 10, false);
    }
  }

  return {
    group, tip, top,
    setPose,
    // flow: 0..1 akış; dirt: ağız altındaki kirlilik; drained: kovadaki su oranı
    update(dt, flow01, dirt, drained) {
      flowMat.opacity += ((flow01 ? 0.25 + dirt * 0.35 : 0) - flowMat.opacity) * Math.min(1, dt * 4);
      bWater.position.y = 0.6 + Math.min(1, drained) * 22;
      bWater.scale.setScalar(0.85 + Math.min(1, drained) * 0.15);
      const axis = _b.subVectors(top, tip);
      for (let i = 0; i < N; i++) {
        if (dT[i] < 0) {
          if (flow01 && Math.random() < dt * (4 + dirt * 40)) { dT[i] = 0; dOff[i * 2] = (Math.random() - 0.5) * 2; dOff[i * 2 + 1] = (Math.random() - 0.5) * 2; }
          else { dPos[i * 3 + 1] = -999; continue; }
        }
        dT[i] += dt * (0.25 + Math.random() * 0.1) * (flow01 ? 1 : 0.2);
        if (dT[i] > 1) { dT[i] = -1; continue; }
        // ağızın etrafından girer, boru içinde sarmal yükselir
        const t = dT[i];
        const sw = Math.sin(t * 20 + i) * 0.5;
        dPos[i * 3] = tip.x + axis.x * t + (dOff[i * 2] + sw) * (t < 0.05 ? 1.6 : 0.8);
        dPos[i * 3 + 1] = tip.y + axis.y * t - (t < 0.05 ? (0.05 - t) * 10 : 0);
        dPos[i * 3 + 2] = tip.z + axis.z * t + dOff[i * 2 + 1] * (t < 0.05 ? 1.6 : 0.8);
      }
      dGeo.attributes.position.needsUpdate = true;
    },
    // balıkların kaçındığı boru boyunca küreler
    obstacles() {
      const list = [];
      for (let k = 0; k <= 5; k++) list.push({ pos: new THREE.Vector3().lerpVectors(tip, top, k / 5), r: 3.5, core: 2.2 });
      return list;
    },
  };
}

// Dolum sürahisi: plastik sürahi, eğilince ağzından suyun yüzeyine akan bir su sütunu
export function createJug() {
  const group = new THREE.Group();
  const tilt = new THREE.Group();
  group.add(tilt);
  group.visible = false;
  const prof = [new THREE.Vector2(0.01, 0)];          // kapalı taban
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const r = 5.2 - Math.pow(t, 3) * 1.4 + Math.sin(t * Math.PI) * 0.3;
    prof.push(new THREE.Vector2(Math.max(0.1, r), t * 15));
  }
  // opak açık mavi plastik sürahi (dolum için tipik su kabı)
  const mat = new THREE.MeshStandardMaterial({ color: 0x8fc3dc, roughness: 0.38, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), mat);
  body.position.y = -7.5;
  tilt.add(body);
  // gaga (ağız) ve sap
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 2.2, 3.2, 20, 1, true), mat);
  spout.position.set(0, 7.2, -4.2);
  spout.rotation.x = -0.9;
  tilt.add(spout);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(4, 0.7, 10, 24, Math.PI), new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.4 }));
  handle.rotation.y = Math.PI / 2;
  handle.rotation.z = -Math.PI / 2;
  handle.position.set(0, 0, 5.4);
  tilt.add(handle);
  const mouth = new THREE.Object3D();
  mouth.position.set(0, 8.4, -5.6);
  tilt.add(mouth);

  // su sütunu: ince, hafif titreyen, aşağı doğru incelen akıntı
  const streamMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOn: { value: 0 } },
    vertexShader: `varying vec2 vUv; uniform float uTime; void main(){ vUv = uv; vec3 p = position; p.x += sin(uv.y * 30.0 + uTime * 20.0) * 0.04; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uOn;
      void main(){ float streak = 0.6 + 0.4 * sin(vUv.x * 40.0 + vUv.y * 6.0 - uTime * 30.0);
        float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
        gl_FragColor = vec4(vec3(0.8, 0.92, 1.0) * streak, (0.35 + 0.4 * edge) * uOn); }`,
    transparent: true, depthWrite: false,
  });
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.4, 1, 12, 8, true), streamMat);
  stream.renderOrder = 8;
  group.add(stream);

  const st = { tilt: 0, pouring: false, fill: 1 };
  const out = new THREE.Vector3();
  return {
    group, stream,
    set pouring(v) { st.pouring = v; },
    get pouring() { return st.pouring; },
    // döndürür: dökülme noktası (dünya) ya da null
    update(dt, level, t) {
      const target = st.pouring ? 1.25 - st.fill * 0.35 : 0.1;   // boşaldıkça daha çok eğilir
      st.tilt += (target - st.tilt) * Math.min(1, dt * 3.5);
      tilt.rotation.x = -st.tilt;
      streamMat.uniforms.uTime.value = t;
      const on = st.pouring && st.tilt > 0.75 ? 1 : 0;
      streamMat.uniforms.uOn.value += (on - streamMat.uniforms.uOn.value) * Math.min(1, dt * 8);
      tilt.updateMatrixWorld(true);
      mouth.getWorldPosition(out);
      const h = Math.max(0.5, out.y - level);
      // sütun grubun çocuğu: dünya konumunu grubun yerel uzayına çevir
      stream.position.set(out.x - group.position.x, out.y - h / 2 - group.position.y, out.z - group.position.z);
      stream.scale.set(1, h, 1);
      stream.visible = streamMat.uniforms.uOn.value > 0.02;
      return on ? out : null;
    },
    setFill(f) { st.fill = f; },
  };
}
