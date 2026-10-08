import * as THREE from 'three';

// Elde tutulan pul yem kutusu: etiketli silindir, delikli serpme kapağı.
// Basılı tutunca kutu suya doğru eğilir ve bilekten sallanır; her sallamada kapağın deliklerinden birkaç pul düşer.
export function createFeeder() {
  const group = new THREE.Group();     // el: konum
  const tilt = new THREE.Group();      // bilek: eğim + sallama (pivot kutunun ortası)
  group.add(tilt);

  const R = 2.2, Hc = 6.6;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, Hc, 40, 1, false),
    new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.35, metalness: 0.05 }),
  );
  body.castShadow = true;
  tilt.add(body);
  // alt kenar ve kapak (beyaz plastik), kapakta serpme delikleri
  const plastic = new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.45 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.35, 40), plastic);
  base.position.y = -Hc / 2 + 0.17;
  tilt.add(base);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.06, R * 1.06, 1.1, 40), plastic);
  cap.position.y = Hc / 2 + 0.5;
  cap.castShadow = true;
  tilt.add(cap);
  const top = new THREE.Mesh(new THREE.CircleGeometry(R * 1.05, 40), new THREE.MeshStandardMaterial({ map: holesTexture(), roughness: 0.5 }));
  top.rotation.x = -Math.PI / 2;
  top.position.y = Hc / 2 + 1.06;
  tilt.add(top);
  // açılmış serpme kapakçığı (yarım daire, menteşeden kalkık)
  const flapPivot = new THREE.Group();
  flapPivot.position.set(0, Hc / 2 + 1.07, 0);
  const flap = new THREE.Mesh(new THREE.CircleGeometry(R * 0.95, 32, 0, Math.PI), plastic.clone());
  flap.material.side = THREE.DoubleSide;
  flap.rotation.x = -Math.PI / 2;
  flapPivot.add(flap);
  flapPivot.rotation.x = 1.9;              // delikli yarıyı açığa çıkarıp dik durur
  tilt.add(flapPivot);
  // dökülme noktası: kapak deliklerinin merkezi (eğim grubunun yerel uzayında)
  const mouth = new THREE.Object3D();
  mouth.position.set(0, Hc / 2 + 1.1, -R * 0.45);
  tilt.add(mouth);

  group.visible = false;
  const st = { tilt: 0, shake: 0, phase: 0, pouring: false, lastPeak: 0 };
  const _p = new THREE.Vector3();

  return {
    group,
    height: Hc + 1.2,
    set pouring(v) { st.pouring = v; },
    get pouring() { return st.pouring; },
    // dt: saniye; emit(pos) her sallama tepesinde çağrılır
    update(dt, emit) {
      const target = st.pouring ? 2.15 : 0.25;            // eğilip kapağı suya çevirme
      st.tilt += (target - st.tilt) * Math.min(1, dt * (st.pouring ? 7 : 5));
      st.shake += ((st.pouring && st.tilt > 1.6 ? 1 : 0) - st.shake) * Math.min(1, dt * 10);
      st.phase += dt * Math.PI * 2 * 5.5;                   // bilekten ~5 Hz sallama
      const s = Math.sin(st.phase);
      tilt.rotation.set(0, 0, 0);
      tilt.rotation.x = -(st.tilt + s * 0.16 * st.shake);   // kapak tankın içine (arkaya) doğru eğilir
      tilt.position.y = -s * 0.25 * st.shake;
      // tepe noktasında (ani duruşta) pullar delikten fırlar
      if (st.shake > 0.6 && s > 0.95 && st.phase - st.lastPeak > 2) {
        st.lastPeak = st.phase;
        tilt.updateMatrixWorld(true);
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) emit(mouth.getWorldPosition(_p).clone());
      }
    },
  };
}

function labelTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#0f5e63'); grd.addColorStop(0.55, '#127a6f'); grd.addColorStop(1, '#0b3f45');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 256);
  // dalga şeridi
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath(); g.moveTo(0, 190);
  for (let x = 0; x <= 1024; x += 16) g.lineTo(x, 190 + Math.sin(x / 40) * 10);
  g.lineTo(1024, 256); g.lineTo(0, 256); g.fill();
  // balık silueti
  const fish = (x, y, s, col) => {
    g.fillStyle = col;
    g.beginPath(); g.ellipse(x, y, 46 * s, 20 * s, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(x + 40 * s, y); g.lineTo(x + 72 * s, y - 20 * s); g.lineTo(x + 72 * s, y + 20 * s); g.fill();
    g.fillStyle = '#0b2a2e'; g.beginPath(); g.arc(x - 28 * s, y - 4 * s, 3.5 * s, 0, 7); g.fill();
  };
  fish(150, 120, 1.3, '#ff8a3d'); fish(860, 90, 0.8, '#5ad1ff'); fish(900, 150, 0.6, '#ffd166');
  g.fillStyle = '#f6f3ea';
  g.font = '700 64px system-ui, sans-serif';
  g.fillText('Pul Yem', 290, 120);
  g.font = '500 30px system-ui, sans-serif';
  g.fillStyle = 'rgba(246,243,234,0.8)';
  g.fillText('Tropikal balıklar için · 50 g', 292, 165);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function holesTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#efede6'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#2a2622';
  // kapağın yarısında serpme delikleri
  for (let r = 18; r < 100; r += 22) {
    const n = Math.floor(r / 6);
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (1 + (i + 0.5) / n);
      g.beginPath(); g.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 5, 0, 7); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
