// Tüm ölçüler santimetre. Tankın iç tabanı y=0, iç yüzey merkezi x=0,z=0.
export const TANKS = {
  nano: { w: 60, h: 36, d: 30, water: 33, cap: 30, liters: 60, name: 'Nano tank', desc: '60 × 30 × 36 cm. Başlangıç için derli toplu bir tank.', price: 0 },
  mid: { w: 90, h: 45, d: 40, water: 42, cap: 45, liters: 150, name: 'Orta tank', desc: '90 × 40 × 45 cm. Sürüler için uzun yüzme alanı, daha kararlı su.', price: 140, level: 4 },
  big: { w: 120, h: 50, d: 45, water: 47, cap: 60, liters: 250, name: 'Büyük tank', desc: '120 × 45 × 50 cm. Melek balıkları ve kalabalık sürüler için gösteri tankı.', price: 320, level: 6 },
};
export const TANK = { glass: 0.6 };
export let HALF_W = 30;
export let HALF_D = 15;

export function setTank(key) {
  if (!TANKS[key]) key = 'nano';
  const t = TANKS[key];
  Object.assign(TANK, { key, w: t.w, h: t.h, d: t.d, water: t.water, cap: t.cap });
  // Nano tanka göre su hacmi oranı: büyük tankta atık daha çok seyrelir
  TANK.vol = (t.w * t.d * t.water) / (60 * 30 * 33);
  // Dekor yerleşimi nano tanka göre tasarlandı; büyük tanklarda bu oranlarla yayılır
  TANK.sx = t.w / 60; TANK.sz = t.d / 30; TANK.sy = t.water / 33;
  HALF_W = t.w / 2;
  HALF_D = t.d / 2;
}

function savedTank() {
  try { return JSON.parse(localStorage.getItem('vivarium.save.v1'))?.tank; } catch { return null; }
}
setTank(savedTank());

// 1 gerçek saniye = 1 oyun dakikası (1× hızda)
export const GAME_MIN_PER_SEC = 1;
export const LIGHT_ON_HOUR = 8;
export const LIGHT_OFF_HOUR = 21;
export const OFFLINE_CAP_MIN = 12 * 60;

// Dokunmatik / küçük ekran: daha hafif görüntü ayarları
export const MOBILE = typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600);
