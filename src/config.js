// Tüm ölçüler santimetre. Tankın iç tabanı y=0, iç yüzey merkezi x=0,z=0.
export const TANK = {
  w: 60,
  h: 36,
  d: 30,
  water: 33,
  glass: 0.6,
};

export const HALF_W = TANK.w / 2;
export const HALF_D = TANK.d / 2;

// 1 gerçek saniye = 1 oyun dakikası (1× hızda)
export const GAME_MIN_PER_SEC = 1;
export const LIGHT_ON_HOUR = 8;
export const LIGHT_OFF_HOUR = 21;
export const OFFLINE_CAP_MIN = 12 * 60;

// Dokunmatik / küçük ekran: daha hafif görüntü ayarları
export const MOBILE = typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600);
