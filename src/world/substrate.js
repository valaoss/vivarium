import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TANK, HALF_W, HALF_D } from '../config.js';
import { patchUnderwater } from '../render/water.js';
import { fbm3, noise3, mulberry } from '../render/textures.js';
import { pbrSet, triplanarHook } from '../render/assets.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Kum yüksekliği: arkaya doğru yükselen klasik akvaskep eğimi + yumuşak tepecikler
export function sandHeight(x, z) {
  const back = (HALF_D - z) / TANK.d;            // 0 ön .. 1 arka
  let h = 2.2 + back * back * 4.8 * TANK.sy;
  h += fbm3(x * 0.06, z * 0.06, 2.0, 3) * 1.1;
  // sağ arkada hafif tepe (taş grubu için)
  h += Math.exp(-((x - 12 * TANK.sx) ** 2 + (z + 6 * TANK.sz) ** 2) / (120 * TANK.sx)) * 1.6;
  return Math.max(1.2, h);
}

export function createSubstrate(scene) {
  const group = new THREE.Group();
  const sandSet = pbrSet('sand_02', [4, 2]);

  // Kum: ızgara + yükseklik + ön kesit (camdan görünen katman)
  const segX = Math.round(120 * TANK.sx), segZ = Math.round(60 * TANK.sz);
  const geo = new THREE.PlaneGeometry(TANK.w - 0.1, TANK.d - 0.1, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, sandHeight(x, z));
  }
  geo.computeVertexNormals();
  const sandMat = patchUnderwater(new THREE.MeshStandardMaterial({
    ...sandSet, color: new THREE.Color(1.95, 1.78, 1.45), normalScale: new THREE.Vector2(1.2, 1.2), roughness: 1, metalness: 0,
  }), { key: 'sand' });
  const sand = new THREE.Mesh(geo, sandMat);
  sand.receiveShadow = true;
  sand.name = 'sand';
  group.add(sand);

  // Ön camdan görünen kum katmanı (kesit)
  const sideGeo = new THREE.PlaneGeometry(TANK.w - 0.1, 1, segX, 1);
  const sp = sideGeo.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i);
    const top = sp.getY(i) > 0;
    sp.setY(i, top ? sandHeight(x, HALF_D - 0.06) : 0);
    sp.setZ(i, HALF_D - 0.06);
  }
  sideGeo.computeVertexNormals();
  const sideMat = patchUnderwater(new THREE.MeshStandardMaterial({
    map: sandSet.map, roughness: 1, color: new THREE.Color(1.5, 1.38, 1.15),
  }), { key: 'sandside', caustics: false });
  group.add(new THREE.Mesh(sideGeo, sideMat));
  // Arka kesit (tankın arkasından bakınca görünür)
  const backGeo = new THREE.PlaneGeometry(TANK.w - 0.1, 1, segX, 1);
  backGeo.rotateY(Math.PI);
  const bp = backGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i);
    const top = bp.getY(i) > 0;
    bp.setY(i, top ? sandHeight(x, -HALF_D + 0.06) : 0);
    bp.setZ(i, -HALF_D + 0.06);
  }
  backGeo.computeVertexNormals();
  group.add(new THREE.Mesh(backGeo, sideMat));
  for (const sx of [-1, 1]) {
    const lg = new THREE.PlaneGeometry(TANK.d - 0.1, 1, segZ, 1);
    const lp = lg.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const z = -lp.getX(i) * sx;
      const top = lp.getY(i) > 0;
      lp.setXYZ(i, sx * (HALF_W - 0.06), top ? sandHeight(sx * (HALF_W - 0.06), z) : 0, z);
    }
    lg.computeVertexNormals();
    const m = new THREE.Mesh(lg, sideMat);
    group.add(m);
  }

  // Çakıllar: küçük, yassı, renk varyasyonlu taşlar
  const r = mulberry(42);
  const pebbleGeo = smoothIco(1, 2);
  {
    const p = pebbleGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      v.multiplyScalar(1 + noise3(v.x * 2, v.y * 2, v.z * 2) * 0.18);
      p.setXYZ(i, v.x, v.y * 0.55, v.z);
    }
    pebbleGeo.computeVertexNormals();
  }
  const pebbleSet = pbrSet('dark_rock');
  const pebbleMat = patchUnderwater(new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, color: new THREE.Color(3.4, 3.25, 3.0) }), { key: 'pebble', extra: triplanarHook(pebbleSet, 0.5) });
  const N = Math.round(160 * TANK.sx * TANK.sz);
  const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p3 = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const x = (r() - 0.5) * (TANK.w - 3);
    const z = (r() - 0.5) * (TANK.d - 3);
    const size = 0.25 + r() ** 3 * 0.9;
    p3.set(x, sandHeight(x, z) + size * 0.15, z);
    q.setFromEuler(new THREE.Euler(r() * 0.3, r() * Math.PI * 2, r() * 0.3));
    s.set(size * (0.8 + r() * 0.5), size, size * (0.8 + r() * 0.5));
    m4.compose(p3, q, s);
    pebbles.setMatrixAt(i, m4);
    const tone = 0.45 + r() * 0.75;
    col.setRGB(tone * (0.95 + r() * 0.15), tone * 0.92, tone * (0.82 + r() * 0.1));
    pebbles.setColorAt(i, col);
  }
  pebbles.castShadow = true;
  pebbles.receiveShadow = true;
  group.add(pebbles);

  const rocks = createRocks(group);
  const wood = createDriftwood(group);
  const equipment = createEquipment(group);

  scene.add(group);
  return { group, sand, rocks, wood, equipment };
}

// Seiryu tarzı köşeli gri taşlar
function createRocks(group) {
  const rockSet = pbrSet('dark_rock');
  const mat = patchUnderwater(new THREE.MeshStandardMaterial({
    color: new THREE.Color(3.3, 3.25, 3.1), roughness: 1, vertexColors: true,
  }), { key: 'rock', extra: triplanarHook(rockSet, 0.09) });

  const defs = [
    { x: 12, z: -6, sx: 7.5, sy: 9.5, sz: 5.5, ry: 0.4, seed: 1 },
    { x: 18.5, z: -2, sx: 4.6, sy: 5.2, sz: 4, ry: -0.6, seed: 2 },
    { x: 7, z: -1, sx: 3.2, sy: 3, sz: 3, ry: 1.2, seed: 3 },
    { x: -20, z: 3, sx: 3.6, sy: 2.6, sz: 3, ry: 0.2, seed: 4 },
  ];
  // Büyük tanklarda boşluğu dolduran ek taşlar
  if (TANK.sx > 1) defs.push(
    { x: 15.5, z: 4, sx: 2.4, sy: 2, sz: 2.2, ry: 2.1, seed: 5 },
    { x: -1, z: -9, sx: 3.4, sy: 4.2, sz: 2.8, ry: -1.1, seed: 6 },
  );
  if (TANK.sx > 1.6) defs.push(
    { x: -6, z: 7, sx: 1.8, sy: 1.4, sz: 1.6, ry: 0.7, seed: 7 },
    { x: 24, z: -7.5, sx: 3, sy: 3.6, sz: 2.6, ry: 0.9, seed: 8 },
  );
  const obstacles = [];
  const k = Math.sqrt(TANK.sx);
  for (const d0 of defs) {
    const d = { ...d0, x: d0.x * TANK.sx, z: d0.z * TANK.sz, sx: d0.sx * k, sy: d0.sy * k, sz: d0.sz * k };
    const geo = smoothIco(1, 6);
    const p = geo.attributes.position;
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const n = fbm3(v.x * 1.4 + d.seed * 9, v.y * 1.4, v.z * 1.4, 5);
      // keskin tabakalar: terraslama
      let k = 1 + n * 0.32;
      const strata = Math.sin((v.y + n * 0.3) * 9) * 0.03;
      k += strata;
      // tabanı düzleştir
      v.multiplyScalar(k);
      if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.2;
      p.setXYZ(i, v.x, v.y, v.z);
      const fine = noise3(v.x * 9 + d.seed, v.y * 9, v.z * 9) * 0.12;
      const shade = Math.max(0.35, 0.72 + n * 0.55 + strata * 4 + fine - Math.max(0, -v.y) * 0.25);
      const vein = Math.abs(Math.sin(v.x * 6 + v.y * 8 + n * 4)) < 0.05 ? 1.25 : 1;
      colors[i * 3] = shade * vein * 0.96;
      colors[i * 3 + 1] = shade * vein;
      colors[i * 3 + 2] = shade * vein * 0.98;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const rock = new THREE.Mesh(geo, mat);
    const base = sandHeight(d.x, d.z);
    rock.scale.set(d.sx, d.sy, d.sz);
    rock.position.set(d.x, base + d.sy * 0.15, d.z);
    rock.rotation.y = d.ry;
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
    obstacles.push({ pos: new THREE.Vector3(d.x, base + d.sy * 0.4, d.z), r: Math.max(d.sx, d.sz) * 1.05, top: base + d.sy * 1.05, mesh: rock });
  }
  loadScannedRocks(obstacles.map((o) => o.mesh));
  return obstacles;
}

// Poly Haven taş taramaları (CC0) yüklenince prosedürel taşların yerini alır
function loadScannedRocks(meshes) {
  const base = `${import.meta.env.BASE_URL}models/hardscape/`;
  const loader = new GLTFLoader();
  const names = ['rock_07', 'rock_09'];
  const loaded = {};
  names.forEach((name) => {
    loader.load(`${base}${name}/${name}_1k.gltf`, (gltf) => {
      let src = null;
      gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
      if (!src) return;
      const geo = src.geometry.clone();
      geo.applyMatrix4(src.matrixWorld);
      // Birim kutuya oturt: x,z -1..1, taban -0.35, tepe 1.0 (prosedürel taşla aynı)
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const c = bb.getCenter(new THREE.Vector3());
      const sz = bb.getSize(new THREE.Vector3());
      geo.translate(-c.x, -bb.min.y, -c.z);
      geo.scale(2 / sz.x, 1.35 / sz.y, 2 / sz.z);
      geo.translate(0, -0.35, 0);
      geo.computeBoundingSphere();
      const m = src.material.clone();
      m.color = new THREE.Color(0.92, 0.94, 0.97);
      patchUnderwater(m, { key: 'rock-scan' });
      loaded[name] = { geo, mat: m };
      meshes.forEach((mesh, i) => {
        if (names[i % names.length] !== name) return;
        mesh.geometry.dispose();
        mesh.geometry = geo;
        mesh.material = m;
      });
    });
  });
}

// Dallanan kök (driftwood)
function createDriftwood(group) {
  const mat = patchUnderwater(new THREE.MeshStandardMaterial({
    ...pbrSet('bark_willow', [3, 1]), color: new THREE.Color(1.15, 1.0, 0.9), normalScale: new THREE.Vector2(1.6, 1.6), roughness: 1,
  }), { key: 'wood' });

  const branches = [
    [[-24, 2.5, -9], [-17, 6, -7], [-10, 11, -9], [-4, 18, -11], [1, 22, -12]],
    [[-17, 6, -7], [-20, 13, -10], [-23, 21, -12]],
    [[-10, 11, -9], [-6, 12, -4], [-2, 12.5, -2]],
    [[-22, 3, -9], [-27, 4.5, -4], [-28.5, 8, 0]],
    [[-4, 18, -11], [-1, 24, -9], [4, 27, -10]],
  ];
  const radii = [1.5, 0.75, 0.6, 0.85, 0.5].map((r) => r * (1 + (TANK.sx - 1) * 0.5));
  const obstacles = [];
  branches.forEach((pts, bi) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0] * TANK.sx, p[1] * TANK.sy, p[2] * TANK.sz)));
    const tubular = 80, radial = 14;
    const geo = new THREE.TubeGeometry(curve, tubular, radii[bi], radial, false);
    const p = geo.attributes.position;
    // Yüzeyi engebeli yap + uçlara doğru incelt
    const center = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      const ring = Math.floor(i / (radial + 1));
      const t = ring / tubular;
      curve.getPointAt(Math.min(t, 1), center);
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const off = v.clone().sub(center);
      const taper = 1 - t * 0.65;
      const n = fbm3(v.x * 0.5, v.y * 0.5, v.z * 0.5 + bi, 4);
      const ridge = Math.sin(Math.atan2(off.y, off.x) * 5 + t * 20) * 0.08;
      off.multiplyScalar(taper * (1 + n * 0.35 + ridge));
      v.copy(center).add(off);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    for (let k = 0; k <= 6; k++) {
      const c = curve.getPointAt(k / 6);
      obstacles.push({ pos: c, r: radii[bi] * 2 + 1 });
    }
    // uç kapakları
    const tip = new THREE.Mesh(new THREE.SphereGeometry(radii[bi] * 0.4, 8, 6), mat);
    tip.position.copy(curve.getPointAt(1));
    group.add(tip);
  });
  return obstacles;
}

// Filtre, hava taşı ve ısıtıcı
function createEquipment(group) {
  const plastic = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.45 }), { key: 'plastic' });
  const glassTube = new THREE.MeshPhysicalMaterial({
    color: 0xd8efe8, roughness: 0.05, transparent: true, opacity: 0.12, clearcoat: 1, depthWrite: false,
  });

  // İç filtre (sol arka köşe)
  const filter = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(5, 18, 3.5), plastic);
  body.position.y = 9;
  filter.add(body);
  // ızgara yarıkları
  const slotMat = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.9 }), { key: 'slot' });
  for (let i = 0; i < 10; i++) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.35, 0.1), slotMat);
    slot.position.set(0, 2 + i * 0.9, 1.78);
    filter.add(slot);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(5.5, 4, 4), plastic);
  head.position.y = 20;
  filter.add(head);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 3, 12), plastic);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 20.5, 3);
  filter.add(nozzle);
  filter.position.set(-HALF_W + 3.5, 6 + TANK.water - 33, -HALF_D + 2.2);
  filter.traverse((o) => { o.castShadow = true; });
  group.add(filter);

  // Hava taşı + hortum (sağ arka)
  const stoneMat = patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 1 }), { key: 'airstone' });
  const ax = 22 * TANK.sx, az = -10 * TANK.sz;
  const stone = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.4, 16), stoneMat);
  stone.rotation.z = Math.PI / 2;
  stone.position.set(ax, sandHeight(ax, az) + 0.8, az);
  group.add(stone);
  const hosePts = [
    new THREE.Vector3(ax + 1.2, stone.position.y, az),
    new THREE.Vector3(ax + 4, stone.position.y + 1, az - 2),
    new THREE.Vector3(HALF_W - 0.8, 12, -HALF_D + 0.8),
    new THREE.Vector3(HALF_W - 0.8, TANK.h + 3, -HALF_D + 0.8),
  ];
  const hose = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hosePts), 40, 0.3, 8),
    patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x9fc8bc, roughness: 0.3, transparent: true, opacity: 0.35, depthWrite: false }), { key: 'hose', caustics: false }),
  );
  group.add(hose);

  // Isıtıcı (sol yan cama yakın)
  const heater = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 20, 16), glassTube);
  heater.add(tube);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 17, 12), patchUnderwater(new THREE.MeshStandardMaterial({ color: 0x3d2a1e, roughness: 0.6 }), { key: 'heatercore' }));
  heater.add(core);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 3, 16), plastic);
  cap.position.y = 11;
  heater.add(cap);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff3a1a }));
  led.position.set(0, 11, 1.1);
  heater.add(led);
  heater.position.set(-HALF_W + 1.6, 19 * TANK.sy, 4 * TANK.sz);
  heater.rotation.z = 0.12;
  group.add(heater);

  return {
    airstone: new THREE.Vector3(ax, stone.position.y + 1, az),
    filterOut: new THREE.Vector3(filter.position.x, filter.position.y + 20.5, filter.position.z + 3.5),
    heaterLed: led,
    obstacles: [
      { pos: new THREE.Vector3(filter.position.x, filter.position.y + 9, filter.position.z), r: 5 },
      { pos: heater.position.clone(), r: 2.5 },
    ],
  };
}

// Kenar paylaşımlı (indeksli) ikozahedron: yumuşak normaller için
function smoothIco(r, detail) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return mergeVertices(g);
}
