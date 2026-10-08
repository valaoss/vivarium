import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TANK, HALF_W, HALF_D, MOBILE } from '../config.js';
import { pbrSet, loadEnvironment } from './assets.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MOBILE ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 1, 1200);
  camera.position.set(6, TANK.h * 0.61, 108 * TANK.sx ** 0.3);
  return camera;
}

export function createControls(camera, dom) {
  const c = new OrbitControls(camera, dom);
  c.target.set(0, TANK.h * 0.42, 0);
  c.enableDamping = true;
  c.dampingFactor = 0.07;
  c.enablePan = false;
  c.minDistance = 30;
  c.maxDistance = 190;
  c.minPolarAngle = 0.55;
  c.maxPolarAngle = 1.72;
  c.rotateSpeed = 0.55;
  c.zoomSpeed = 0.8;
  c.update();
  return c;
}

/** Loş oda, dolap ve aydınlatma. Dönen nesne gün/gece güncellemesi için ışıkları tutar. */
export function createRoom(scene, renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  loadEnvironment(renderer, scene, 'hotel_room');
  scene.environmentIntensity = 0.2;
  scene.background = new THREE.Color(0x0b0a09);

  const floorY = -72;

  // Zemin (parke)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ ...pbrSet('laminate_floor_02', [5, 5]), metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  scene.add(floor);

  // Duvarlar
  const wallMat = new THREE.MeshStandardMaterial({ ...pbrSet('beige_wall_001', [3, 1.5]), color: 0x8a8378 });
  // Tank odanın ortasında: kamera her yönden dönebilsin diye dört duvar
  const R = 230;
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c4, roughness: 0.6 });
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, 300), wallMat);
    wall.position.set(-Math.sin(a) * R, floorY + 150, -Math.cos(a) * R);
    wall.rotation.y = a;
    wall.receiveShadow = true;
    scene.add(wall);
    const skirting = new THREE.Mesh(new THREE.BoxGeometry(2 * R, 8, 1.5), skirtMat);
    skirting.position.set(-Math.sin(a) * (R - 0.8), floorY + 4, -Math.cos(a) * (R - 0.8));
    skirting.rotation.y = a;
    scene.add(skirting);
  }

  // Dolap (koyu ceviz)
  const cabW = TANK.w + 8, cabD = TANK.d + 8, cabH = 70;
  const cabTop = -TANK.glass - 1.2;
  const cabMat = new THREE.MeshStandardMaterial({ ...pbrSet('dark_wood', [1, 1]), color: 0x8c7a6c, metalness: 0 });
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(cabW, cabH, cabD), cabMat);
  cabinet.position.set(0, cabTop - cabH / 2, 0);
  cabinet.castShadow = true;
  cabinet.receiveShadow = true;
  scene.add(cabinet);
  // Kapak çizgisi ve kulplar
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.25, cabH - 8, 0.2), new THREE.MeshStandardMaterial({ color: 0x120c08 }));
  seam.position.set(0, cabTop - cabH / 2, cabD / 2 + 0.05);
  scene.add(seam);
  const handleMat = new THREE.MeshStandardMaterial({ color: 0xb8a27a, metalness: 1, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const hnd = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 10, 12), handleMat);
    hnd.position.set(s * 2.5, cabTop - 18, cabD / 2 + 0.9);
    scene.add(hnd);
  }
  // Tankın altındaki siyah köpük mat
  const mat = new THREE.Mesh(
    new THREE.BoxGeometry(TANK.w + 1.4, 1.2, TANK.d + 1.4),
    new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9 }),
  );
  mat.position.y = -TANK.glass - 0.6;
  mat.receiveShadow = true;
  scene.add(mat);

  // --- Işıklar ---
  // Akvaryum lambası: tepeden yönlü ışık + gölge
  const lamp = new THREE.DirectionalLight(0xffffff, 3.2);
  lamp.position.set(2, 90, 8);
  lamp.target.position.set(0, 0, 0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
  const sc = lamp.shadow.camera;
  sc.left = -HALF_W - 6; sc.right = HALF_W + 6; sc.top = HALF_D + 6; sc.bottom = -HALF_D - 6;
  sc.near = 40; sc.far = 110;
  lamp.shadow.bias = -0.0006;
  lamp.shadow.normalBias = 0.03;
  lamp.shadow.radius = 4;
  scene.add(lamp, lamp.target);

  // Lambadan odaya taşan sıcak ışık (dolabın üstüne ve duvara)
  const spill = new THREE.PointLight(0xffffff, 900, 160, 2);
  spill.position.set(0, TANK.h + 6, 0);
  scene.add(spill);

  // Oda: gündüz pencereden soğuk-loş, gece sıcak abajur
  const hemi = new THREE.HemisphereLight(0x9aa6b8, 0x2a1d14, 0.25);
  scene.add(hemi);
  const window_ = new THREE.DirectionalLight(0xbcd0ff, 0.6);
  window_.position.set(-150, 80, 120);
  scene.add(window_);
  const floorLamp = new THREE.PointLight(0xffa660, 9000, 400, 2);
  floorLamp.position.set(-120, 40, 30);
  scene.add(floorLamp);

  // Abajur gövdesi (odada görsel ipucu)
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 14, 18, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xf3e2c4, emissive: 0xffb070, emissiveIntensity: 0.6, side: THREE.DoubleSide, roughness: 1 }),
  );
  shade.position.set(-120, 46, 30);
  scene.add(shade);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 115, 8), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.8, roughness: 0.4 }));
  pole.position.set(-120, floorY + 57, 30);
  scene.add(pole);

  return { lamp, spill, hemi, window: window_, floorLamp, shade, floorY };
}
