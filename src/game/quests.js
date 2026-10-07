// Öğretici görevler: sırayla açılır, her biri bir sistemi öğretir.
export const QUESTS = [
  {
    id: 'feed', title: 'İlk öğün',
    desc: 'Yem aracını seç ve su yüzeyine dokunarak balıklarına biraz pul yem ver.',
    reward: 15, check: (g) => g.state.counters.fed >= 1,
  },
  {
    id: 'plant', title: 'Yeşil bir dokunuş',
    desc: 'Dükkândan bir bitki al ve kumun üzerine dik.',
    reward: 15, check: (g) => g.state.counters.planted >= 1,
  },
  {
    id: 'observe', title: 'Yakından bak',
    desc: 'Bir balığa dokunarak bilgi kartını aç.',
    reward: 10, check: (g) => g.state.counters.inspected >= 1,
  },
  {
    id: 'school', title: 'Parlak sürü',
    desc: 'En az 5 neon tetradan oluşan bir sürü kur. Neonlar kalabalıkta kendini güvende hisseder.',
    reward: 40, unlock: 'cory', check: (g) => g.count('neon') >= 5,
  },
  {
    id: 'glass', title: 'Berrak bakış',
    desc: 'Ön camda biriken yosunu cam silme aracıyla temizle.',
    reward: 20, check: (g) => g.state.counters.wiped >= 60,
  },
  {
    id: 'clear', title: 'Su değişimi',
    desc: 'Hortumla suyun bir kısmını değiştir. %20–30 idealdir; fazlası balıkları strese sokar.',
    reward: 25, unlock: 'shrimp', check: (g) => g.state.counters.waterChanges >= 1,
  },
  {
    id: 'cory', title: 'Taban temizlikçileri',
    desc: 'Tanka bir Corydoras ekle ve yüzeye hava yutmaya çıkmasını gözlemle.',
    reward: 30, check: (g) => g.state.discoveries.includes('coryAir'),
  },
  {
    id: 'night', title: 'Gece vardiyası',
    desc: 'Lamba kapandıktan sonra balıkların gece davranışını izle (zamanı hızlandırabilirsin).',
    reward: 20, check: (g) => g.state.discoveries.includes('nightNeon'),
  },
  {
    id: 'photo', title: 'Anı yakala',
    desc: 'Fotoğraf modunu aç ve akvaryumunun bir fotoğrafını çek.',
    reward: 20, check: (g) => g.state.counters.photos >= 1,
  },
  {
    id: 'healthy', title: 'Dengeli ekosistem',
    desc: 'Su kalitesini 70 üstünde ve tüm canlıları sağlıklı tutarak 3 gün geçir.',
    reward: 100, check: (g) => g.state.counters.healthyMin >= 3 * 1440, progress: (g) => g.state.counters.healthyMin / (3 * 1440),
  },
];

export function currentQuest(state) {
  return QUESTS[state.questIndex] ?? null;
}
