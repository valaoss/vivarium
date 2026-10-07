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
    level: 2,
    desc: 'Tabanda yaşayan, bıyıklı ve sevimli temizlikçi. Ara sıra yüzeye fırlayıp hava yutar.',
    pattern: 2,
    body: { length: 4.6, height: 1.45, width: 1.0, tail: 'fork', tailLen: 1.1, tailSpread: 0.85, dorsal: [0.25, 0.42, 0.85], anal: [0.62, 0.74, 0.3] },
    cruise: 3, burst: 16, depth: [0, 0.08], school: 0.5, bioload: 1.1, hungerRate: 3.2,
    diet: 'Tabana çöken yem artıkları',
    traits: ['Sakin', 'Sosyal', 'Obur', 'Meraklı'],
  },
  danio: {
    name: 'Zebra danio',
    latin: 'Danio rerio',
    kind: 'fish',
    price: 9,
    level: 3,
    desc: 'Hızlı, enerjik ve çizgili. Yüzeye yakın sürü halinde koşturur.',
    pattern: 3,
    body: { length: 3.4, height: 0.68, width: 0.4, tail: 'fork', tailLen: 0.95, tailSpread: 0.75, dorsal: [0.45, 0.58, 0.45], anal: [0.55, 0.78, 0.35] },
    cruise: 6.5, burst: 26, depth: [0.6, 0.97], school: 0.9, bioload: 0.6, hungerRate: 4.5,
    diet: 'Pul yem',
    traits: ['Meraklı', 'Sosyal', 'Obur'],
  },
  betta: {
    name: 'Beta',
    latin: 'Betta splendens',
    kind: 'fish',
    price: 25,
    level: 5,
    desc: 'Görkemli peçe yüzgeçli, bölgeci bir erkek. Başka betalara ve uzun yüzgeçli balıklara saldırabilir.',
    pattern: 4,
    body: { length: 3.4, height: 1.0, width: 0.6, tail: 'veil', tailLen: 2.6, tailSpread: 1.8, tailLift: -0.2, dorsal: [0.45, 0.85, 1.3], anal: [0.38, 0.95, 1.2] },
    cruise: 2.2, burst: 14, depth: [0.55, 0.95], school: 0, bioload: 1.0, hungerRate: 3,
    diet: 'Granül ve canlı yem',
    traits: ['Bölgeci', 'Meraklı', 'Sakin'],
    territorial: { targets: ['betta', 'guppy', 'gourami'], range: 11 },
  },
  angel: {
    name: 'Melek balığı',
    latin: 'Pterophyllum scalare',
    kind: 'fish',
    price: 30,
    level: 7,
    desc: 'Zarif, uzun yüzgeçli bir çiklit. Büyüdükçe neon gibi küçük balıkları avlayabilir.',
    pattern: 5,
    body: { shape: 'disc', length: 3.4, height: 3.0, width: 0.5, tail: 'fork', tailLen: 1.4, tailSpread: 1.2, dorsal: [0.3, 0.62, 1.05], anal: [0.32, 0.68, 1.05], eyeSize: 0.09 },
    cruise: 2.4, burst: 15, depth: [0.35, 0.85], school: 0.2, bioload: 1.6, hungerRate: 3.2,
    diet: 'Pul, granül ve küçük canlılar',
    traits: ['Sakin', 'Bölgeci', 'Obur'],
    predator: { prey: ['neon', 'cardinal', 'shrimp', 'amano'], range: 14 },
  },
  platy: {
    name: 'Plati',
    latin: 'Xiphophorus maculatus',
    kind: 'fish', livebearer: true,
    price: 10, level: 2,
    desc: 'Tıknaz, turuncu-kırmızı ve çok uysal. Doğurur; yavruları tankta büyür.',
    pattern: 6, colors: [[0xff6a12, 0x1a0a05], [0xe81818, 0x101010], [0xffc020, 0x202a80]],
    body: { length: 3.4, height: 1.25, width: 0.62, tail: 'fork', tailLen: 1.0, tailSpread: 0.85, dorsal: [0.4, 0.62, 0.55], anal: [0.55, 0.72, 0.35] },
    cruise: 3.5, burst: 16, depth: [0.3, 0.85], school: 0.2, bioload: 0.9, hungerRate: 4,
    diet: 'Pul yem ve yosun', traits: ['Sakin', 'Sosyal', 'Obur'],
  },
  molly: {
    name: 'Siyah moli',
    latin: 'Poecilia sphenops',
    kind: 'fish', livebearer: true,
    price: 12, level: 3,
    desc: 'Kadife siyahı, yelken sırtlı bir doğuran tür. Sert ve hafif tuzlu suyu sever.',
    pattern: 7, colors: [[0x060606, 0x30302a]],
    body: { length: 4.0, height: 1.35, width: 0.7, tail: 'fan', tailLen: 1.4, tailSpread: 1.15, dorsal: [0.32, 0.7, 0.8], anal: [0.55, 0.72, 0.35] },
    cruise: 3.2, burst: 15, depth: [0.4, 0.9], school: 0.2, bioload: 1.2, hungerRate: 4,
    diet: 'Pul yem ve bol yosun', traits: ['Sakin', 'Obur', 'Meraklı'],
  },
  swordtail: {
    name: 'Kılıçkuyruk',
    latin: 'Xiphophorus hellerii',
    kind: 'fish', livebearer: true,
    price: 14, level: 4,
    desc: 'Erkeklerin kuyruğunun alt kenarı uzun bir kılıç gibi uzar. Hızlı ve hareketlidir.',
    pattern: 6, colors: [[0xe8380c, 0x101010], [0x3a9a30, 0xd02010]],
    body: { length: 4.2, height: 1.1, width: 0.58, tail: 'sword', tailLen: 1.1, tailSpread: 0.9, dorsal: [0.38, 0.6, 0.6], anal: [0.55, 0.72, 0.35] },
    cruise: 5, burst: 22, depth: [0.4, 0.95], school: 0.15, bioload: 1.1, hungerRate: 4.2,
    diet: 'Pul yem', traits: ['Meraklı', 'Obur', 'Sosyal'],
  },
  cardinal: {
    name: 'Kardinal tetra',
    latin: 'Paracheirodon axelrodi',
    kind: 'fish',
    price: 11, level: 3,
    desc: 'Neonun akrabası; kırmızı renk tüm karnı boyunca uzanır. Kalabalık sürüleri sever.',
    pattern: 8,
    body: { length: 3.3, height: 0.8, width: 0.38, tail: 'fork', tailLen: 0.85, tailSpread: 0.72, dorsal: [0.42, 0.55, 0.5], anal: [0.55, 0.78, 0.35] },
    cruise: 4, burst: 22, depth: [0.25, 0.7], school: 1, bioload: 0.55, hungerRate: 3.6,
    diet: 'Pul yem', traits: ['Çekingen', 'Sosyal', 'Sakin'],
  },
  rasbora: {
    name: 'Harlequin rasbora',
    latin: 'Trigonostigma heteromorpha',
    kind: 'fish',
    price: 9, level: 3,
    desc: 'Bakır renkli gövdesinde siyah üçgen bir leke taşır. Sıkı ve zarif sürüler kurar.',
    pattern: 9,
    body: { length: 3.2, height: 1.0, width: 0.4, tail: 'fork', tailLen: 1.0, tailSpread: 0.8, dorsal: [0.42, 0.56, 0.55], anal: [0.55, 0.72, 0.4] },
    cruise: 4.2, burst: 22, depth: [0.35, 0.8], school: 1, bioload: 0.55, hungerRate: 3.6,
    diet: 'Pul yem', traits: ['Sosyal', 'Sakin', 'Meraklı'],
  },
  barb: {
    name: 'Kiraz barbus',
    latin: 'Puntius titteya',
    kind: 'fish',
    price: 9, level: 2,
    desc: 'Erkekleri kiraz kırmızısıdır. Uysal, bitkili tankları seven bir barbus.',
    pattern: 10,
    body: { length: 3.4, height: 1.05, width: 0.48, tail: 'fork', tailLen: 1.0, tailSpread: 0.8, dorsal: [0.38, 0.55, 0.55], anal: [0.55, 0.72, 0.35] },
    cruise: 3.8, burst: 18, depth: [0.2, 0.7], school: 0.6, bioload: 0.7, hungerRate: 3.8,
    diet: 'Pul yem', traits: ['Sakin', 'Sosyal', 'Çekingen'],
  },
  gourami: {
    name: 'Cüce gurami',
    latin: 'Trichogaster lalius',
    kind: 'fish',
    price: 20, level: 5,
    desc: 'Mavi-kırmızı çapraz çizgili, uzun ip gibi karın yüzgeçleriyle çevresini yoklar. Yüzeyden hava alabilir.',
    pattern: 11,
    body: { length: 3.8, height: 1.7, width: 0.55, tail: 'fan', tailLen: 1.1, tailSpread: 1.0, dorsal: [0.3, 0.85, 0.45], anal: [0.32, 0.92, 0.5] },
    cruise: 2.5, burst: 14, depth: [0.55, 0.95], school: 0, bioload: 1.1, hungerRate: 3.2,
    diet: 'Pul ve granül yem', traits: ['Sakin', 'Meraklı', 'Çekingen'],
  },
  kuhli: {
    name: 'Kuhli çöpçüsü',
    latin: 'Pangio kuhlii',
    kind: 'fish', bottom: true,
    price: 13, level: 4,
    desc: 'Yılana benzeyen turuncu-siyah halkalı küçük bir çöpçü. Gündüz saklanır, gece kumda gezinir.',
    pattern: 12,
    body: { length: 6.5, height: 0.55, width: 0.55, tail: 'fork', tailLen: 0.5, tailSpread: 0.35, dorsal: [0.7, 0.78, 0.25], anal: [0.72, 0.82, 0.2], eyeSize: 0.12 },
    cruise: 2, burst: 12, depth: [0, 0.06], school: 0.3, bioload: 0.6, hungerRate: 2.8,
    diet: 'Tabana çöken yem artıkları', traits: ['Çekingen', 'Sosyal'],
    nocturnal: true,
  },
  oto: {
    name: 'Otocinclus',
    latin: 'Otocinclus vittatus',
    kind: 'fish', bottom: true,
    price: 11, level: 3,
    desc: 'Vantuz ağızlı minik kedi balığı. Bitkilerdeki ve tabandaki yosunu sürekli temizler.',
    pattern: 13,
    body: { length: 3.2, height: 0.75, width: 0.7, tail: 'fork', tailLen: 0.7, tailSpread: 0.6, dorsal: [0.3, 0.45, 0.6], anal: [0.6, 0.72, 0.25] },
    cruise: 1.8, burst: 12, depth: [0, 0.1], school: 0.5, bioload: 0.4, hungerRate: 2.5,
    diet: 'Yosun', traits: ['Sakin', 'Çekingen', 'Obur'],
    algaeEater: 0.6,
  },
  snail: {
    name: 'Nerit salyangoz',
    latin: 'Neritina natalensis',
    kind: 'snail',
    price: 7,
    level: 2,
    desc: 'Camda ve taşlarda yavaşça gezer, yosunu kazıyarak temizler.',
    cruise: 0.35, burst: 0.35, bioload: 0.2, hungerRate: 1.2,
    diet: 'Yosun',
    traits: ['Sakin', 'Obur'],
  },
  shrimp: {
    name: 'Red cherry karides',
    latin: 'Neocaridina davidi',
    kind: 'shrimp',
    price: 6,
    level: 2,
    desc: 'Minik kırmızı temizlikçi. Yosunu ve yem artıklarını toplar.',
    cruise: 1.2, burst: 9, bioload: 0.15, hungerRate: 2,
    diet: 'Yosun ve artıklar',
    traits: ['Çekingen', 'Meraklı', 'Obur'],
  },
  amano: {
    name: 'Amano karides',
    latin: 'Caridina multidentata',
    kind: 'shrimp',
    price: 9, level: 3,
    desc: 'Yarı saydam, noktalı ve iri bir karides. Yosun yemekte çok başarılıdır.',
    cruise: 1.5, burst: 10, bioload: 0.25, hungerRate: 2,
    diet: 'Yosun ve artıklar', traits: ['Obur', 'Meraklı'],
    color: 0x9aa8a0, size: 1.4, algaeEater: 0.4,
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
  Bölgeci: 'Kendi alanını korur, yaklaşanları kovalar.',
};

// Doğa seviyesi eşikleri (toplam deneyim)
export function levelFromXp(xp) {
  let lvl = 1;
  while (xp >= xpForLevel(lvl + 1)) lvl++;
  return lvl;
}
export function xpForLevel(lvl) { return 30 * (lvl - 1) * lvl; }

/** Bir türü eklemeden önce oyuncuya gösterilecek uyumluluk uyarıları. */
export function compatWarnings(key, counts) {
  const sp = SPECIES[key];
  const has = (k) => (counts[k] ?? 0) > 0;
  const out = [];
  if (sp.predator) {
    const prey = sp.predator.prey.filter(has);
    if (prey.length) out.push(`${sp.name}, tankındaki ${prey.map((k) => SPECIES[k].name.toLowerCase()).join(' ve ')} gibi küçük canlıları avlayabilir.`);
  }
  for (const [k, other] of Object.entries(SPECIES)) {
    if (other.predator?.prey.includes(key) && has(k)) out.push(`Tankındaki ${other.name.toLowerCase()}, ${sp.name.toLowerCase()} türünü avlayabilir.`);
  }
  if (sp.territorial) {
    if (key === 'betta' && has('betta')) out.push('İki erkek beta aynı tankta kavga eder.');
    else if (sp.territorial.targets.some((t) => t !== key && has(t))) out.push(`${sp.name}, uzun yüzgeçli lepisteslere saldırıp yüzgeçlerini ısırabilir.`);
  }
  for (const [k, other] of Object.entries(SPECIES)) {
    if (k !== key && other.territorial?.targets.includes(key) && has(k)) out.push(`Tankındaki ${other.name.toLowerCase()} bu türe karşı bölgeci davranabilir.`);
  }
  if (sp.school > 0.5 && (counts[key] ?? 0) < 4) out.push(`${sp.name} sürü balığıdır; en az 5 tane olunca kendini güvende hisseder.`);
  return out;
}
