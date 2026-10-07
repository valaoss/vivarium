import * as THREE from 'three';

/*
 * Prosedürel balık. Yerel eksenler: +Z ileri (burun), +Y yukarı, +X yan.
 * Her köşe `aSeg` taşır: x = burundan kuyruk ucuna 0..1 konum (yüzme dalgası için),
 * y = dikey konum (-1 alt .. 1 üst), z = parça (0 gövde, 1 yüzgeç, 2 göğüs yüzgeci),
 * w = yüzgeç içi uzaklık / yan işaret.
 */
export function buildFish(b) {
  const L = b.length;                 // gövde uzunluğu (kuyruk yüzgeci hariç)
  const total = L + b.tailLen;
  const zNose = total / 2;
  const zTail = zNose - L;            // kuyruk sapı
  const sOf = (z) => (zNose - z) / total;

  // ---- Gövde ----
  const nL = 36, nR = 22;
  const pos = [], seg = [], uv = [], idx = [];
  const prof = (u) => {
    if (b.shape === 'disc') {
      // melek balığı: yuvarlak, yanlardan basık disk + kısa kuyruk sapı
      const k = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08 + 0.04)), 0.6);
      return Math.max(k * (u < 0.12 ? 0.75 + u * 2 : 1), u > 0.85 ? 0.14 : 0.04);
    }
    // u: 0 burun .. 1 kuyruk sapı
    const front = Math.sqrt(Math.sin(Math.min(u / 0.38, 1) * Math.PI / 2));
    const back = 1 - (1 - 0.28) * Math.pow(Math.max(0, (u - 0.38) / 0.62), 1.15);
    const k = u < 0.38 ? front : back;
    return Math.max(k, 0.03);
  };
  for (let i = 0; i <= nL; i++) {
    const u = i / nL;
    const z = zNose - u * L;
    const k = prof(u);
    const h = b.height * 0.5 * k;
    const w = b.width * 0.5 * k * (u < 0.1 ? 0.9 : 1);
    const yc = (b.belly ?? 0.06) * b.height * Math.sin(u * Math.PI) * (u < 0.7 ? 1 : 0.3) - 0.04 * b.height;
    for (let j = 0; j <= nR; j++) {
      const a = (j / nR) * Math.PI * 2;
      const sa = Math.sin(a), ca = Math.cos(a);
      // alt taraf biraz dolgun, sırt hafif sivri
      const yy = sa > 0 ? sa * (1 - 0.08 * Math.abs(ca)) : sa * (1 + 0.06);
      const x = ca * w * (b.flatBelly && sa < 0 ? 1.1 : 1);
      let y = yc + yy * h;
      if (b.flatBelly && sa < -0.3) y = yc - h * 0.82 - (sa + 0.3) * h * 0.25;
      pos.push(x, y, z);
      seg.push(sOf(z), yy, 0, 0);
      uv.push(j / nR, u);
    }
  }
  for (let i = 0; i < nL; i++) for (let j = 0; j < nR; j++) {
    const a = i * (nR + 1) + j, c = a + nR + 1;
    idx.push(a, c, a + 1, c, c + 1, a + 1);
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('aSeg', new THREE.Float32BufferAttribute(seg, 4));
  body.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  body.setIndex(idx);
  body.computeVertexNormals();

  // ---- Yüzgeçler ----
  const fp = [], fs = [], fuv = [], fi = [];
  const addGrid = (nu, nv, fn) => {
    const base = fp.length / 3;
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const r = fn(i / nu, j / nv);
      fp.push(r.x, r.y, r.z);
      fs.push(sOf(r.z), r.v ?? 0, r.part ?? 1, r.w ?? 0);
      fuv.push(i / nu, j / nv);
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = base + i * (nv + 1) + j, c = a + nv + 1;
      fi.push(a, a + 1, c, c, a + 1, c + 1);
    }
  };
  const halfH = (u) => b.height * 0.5 * prof(u);

  // Kuyruk yüzgeci
  const pedH = halfH(1) * 0.9;
  addGrid(14, 12, (u, v) => {
    const vv = v * 2 - 1;
    let len, spread;
    if (b.tail === 'fan' || b.tail === 'veil') {
      spread = pedH + (b.tailSpread - pedH) * Math.pow(u, 0.7);
      len = b.tailLen * (1 - 0.12 * vv * vv);
    } else {
      spread = pedH + (b.tailSpread - pedH) * u;
      len = b.tailLen * (0.6 + 0.4 * Math.pow(Math.abs(vv), 0.8));
    }
    const droop = b.tail === 'veil' ? -Math.pow(u, 1.6) * b.tailLen * 0.35 : 0;
    return { x: 0, y: vv * spread * (b.tail === 'fan' ? 1 : b.tail === 'veil' ? 1.05 : 0.95) + (b.tailLift ?? 0) * u + droop, z: zTail + 0.05 - u * len, v: vv, w: u };
  });

  // Sırt yüzgeci: [başlangıç u, bitiş u, yükseklik oranı]
  const [d0, d1, dh] = b.dorsal;
  addGrid(10, 6, (u, v) => {
    const uu = d0 + (d1 - d0) * u;
    const z = zNose - uu * L;
    const top = halfH(uu) + (0.04 * b.height);
    const hgt = b.height * dh * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.62 + 0.25) * (b.tail === 'fan' || b.tail === 'veil' ? 1.0 + u * 0.6 : 1);
    return { x: 0, y: top + v * hgt * 0.98, z: z - v * hgt * 0.5, v: 1, w: v };
  });

  // Anal yüzgeç
  const [a0, a1, ah] = b.anal;
  addGrid(8, 5, (u, v) => {
    const uu = a0 + (a1 - a0) * u;
    const z = zNose - uu * L;
    const bot = -halfH(uu) * 0.95 + 0.03 * b.height;
    const hgt = b.height * ah * Math.sin(Math.min(1, u * 1.1) * Math.PI * 0.7 + 0.2);
    return { x: 0, y: bot - v * hgt, z: z - v * hgt * 0.45, v: -1, w: v };
  });

  // Göğüs yüzgeçleri (iki yan)
  for (const side of [-1, 1]) {
    const u0 = 0.24;
    const z0 = zNose - u0 * L;
    const w0 = b.width * 0.5 * prof(u0);
    const fl = b.height * 0.42;
    addGrid(5, 4, (u, v) => {
      const vv = v - 0.5;
      return {
        x: side * (w0 * 0.92 + u * fl * 0.55),
        y: -b.height * 0.12 + vv * fl * 0.42 * (0.4 + u) - u * fl * 0.2,
        z: z0 - u * fl * 0.75,
        v: 0, part: 2, w: side * u,
      };
    });
  }
  // Karın yüzgeçleri (küçük)
  for (const side of [-1, 1]) {
    const u0 = 0.48;
    const z0 = zNose - u0 * L;
    const fl = b.height * 0.32 * (b.ventral ?? 1);
    addGrid(4, 3, (u, v) => ({
      x: side * (b.width * 0.12 + u * fl * 0.25),
      y: -halfH(u0) * 0.9 - u * fl * 0.6,
      z: z0 - u * fl * 0.6 - v * fl * 0.35,
      v: -1, part: 2, w: side * u * 0.5,
    }));
  }
  if (b.barbels) {
    for (const side of [-1, 1]) for (const yy of [0, 1]) {
      addGrid(4, 1, (u, v) => ({
        x: side * (0.08 + u * 0.35) + (v - 0.5) * 0.04,
        y: -b.height * 0.22 - yy * 0.06 - u * 0.25,
        z: zNose - 0.12 - u * 0.12,
        v: -1, part: 1, w: u,
      }));
    }
  }

  const fins = new THREE.BufferGeometry();
  fins.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  fins.setAttribute('aSeg', new THREE.Float32BufferAttribute(fs, 4));
  fins.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
  fins.setIndex(fi);
  fins.computeVertexNormals();

  // Göz konumu
  const eyeU = 0.1;
  const eye = {
    z: zNose - eyeU * L - 0.02,
    y: b.height * 0.1,
    x: b.width * 0.5 * prof(eyeU) * 0.9,
    r: b.height * (b.eyeSize ?? 0.15),
  };
  return { body, fins, eye, total };
}
