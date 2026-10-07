// Tür verileri: hem görünüm (geometri/desen) hem davranış parametreleri.
// Uzunluklar cm, hızlar cm/sn.
export const SPECIES = {
  guppy: {
    name: 'Lepistes',
    latin: 'Poecilia reticulata',
    kind: 'fish',
    price: 12,
    desc: 'Renkli kuyruklu, dayanıklı ve meraklı. Suyun üst katmanlarını sever.',
    pattern: 1,
    body: { length: 3.2, height: 0.8, width: 0.46, tail: 'fan', tailLen: 1.9, tailSpread: 1.25, dorsal: [0.45, 0.72, 0.9], anal: [0.55, 0.7, 0.35] },
    cruise: 4.5, burst: 20, depth: [0.5, 0.95], school: 0.15, bioload: 1.0, hungerRate: 4.2,
    diet: 'Pul ve granül yem',
    traits: ['Sakin', 'Meraklı', 'Obur', 'Sosyal'],
  },
  neon: {
    name: 'Neon tetra',
    latin: 'Paracheirodon innesi',
    kind: 'fish',
    price: 8,
    desc: 'Parlak mavi şeritli sürü balığı. En az 5 kişilik grupta kendini güvende hisseder.',
    pattern: 0,
    body: { length: 3.1, height: 0.78, width: 0.36, tail: 'fork', tailLen: 0.8, tailSpread: 0.7, dorsal: [0.42, 0.55, 0.5], anal: [0.55, 0.78, 0.35] },
    cruise: 4, burst: 22, depth: [0.3, 0.75], school: 1, bioload: 0.5, hungerRate: 3.6,
    diet: 'Pul yem',
    traits: ['Çekingen', 'Sosyal', 'Sakin', 'Meraklı'],
  },
  cory: {
    name: 'Corydoras',
    latin: 'Corydoras aeneus',
    kind: 'fish',
    bottom: true,
    price: 15,
    desc: 'Tabanda yaşayan, bıyıklı ve sevimli temizlikçi. Ara sıra yüzeye fırlayıp hava yutar.',
    pattern: 2,
    body: { length: 4.6, height: 1.45, width: 1.0, tail: 'fork', tailLen: 1.1, tailSpread: 0.85, dorsal: [0.25, 0.42, 0.85], anal: [0.62, 0.74, 0.3] },
    cruise: 3, burst: 16, depth: [0, 0.08], school: 0.5, bioload: 1.1, hungerRate: 3.2,
    diet: 'Tabana çöken yem artıkları',
    traits: ['Sakin', 'Sosyal', 'Obur', 'Meraklı'],
  },
  shrimp: {
    name: 'Red cherry karides',
    latin: 'Neocaridina davidi',
    kind: 'shrimp',
    price: 6,
    desc: 'Minik kırmızı temizlikçi. Yosunu ve yem artıklarını toplar.',
    cruise: 1.2, burst: 9, bioload: 0.15, hungerRate: 2,
    diet: 'Yosun ve artıklar',
    traits: ['Çekingen', 'Meraklı', 'Obur'],
  },
};

export const NAMES = [
  'Pırıl', 'Mavi', 'Çaka', 'Fıstık', 'Bulut', 'Lale', 'Zeytin', 'Kıvılcım', 'Nar', 'Yakamoz',
  'Minnoş', 'Pamuk', 'Şimşek', 'Duman', 'Kiraz', 'Badem', 'Damla', 'Kumru', 'Mercan', 'Tarçın',
  'Fındık', 'Poyraz', 'Lodos', 'Simit', 'Leblebi', 'Zıpzıp', 'Boncuk', 'Karamel', 'Sedef', 'İnci',
];

export const TRAIT_INFO = {
  Meraklı: 'Cama ve yeni nesnelere yaklaşır.',
  Çekingen: 'Bitkilere yakın durur, kolay ürker.',
  Obur: 'Daha çabuk acıkır, yeme ilk o koşar.',
  Sakin: 'Yavaş yüzer, az strese girer.',
  Sosyal: 'Kendi türüyle yakın durmayı sever.',
};
