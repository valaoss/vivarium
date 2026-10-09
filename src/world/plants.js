import * as THREE from 'three';
import { mulberry } from '../render/textures.js';
import { sandHeight } from './substrate.js';
import { buildFrogbit, buildLudwigia } from './proceduralPlants.js';
import { TANK, HALF_W, HALF_D } from '../config.js';
import { buildSword, buildCrypt, buildAnubias, buildJavafern, buildVallisneria } from './leafPlants.js';

export const PLANT_TYPES = {
  vallisneria: { name: 'Vallisneria', price: 6, desc: 'Uzun, şerit yapraklı çim bitkisi. Hızlı büyür, suyu temizler.', o2: 1.2, uptake: 1.3 },
  javafern: { name: 'Java eğrelti otu', price: 10, desc: 'Dayanıklı, mızrak yapraklı. Kök ve taşa tutunur.', o2: 0.8, uptake: 0.8 },
  anubias: { name: 'Anubias', price: 12, desc: 'Koyu ve parlak yapraklı, çok yavaş büyür, neredeyse ölümsüz.', o2: 0.6, uptake: 0.5 },
  crypt: { name: 'Kriptokorin', latin: 'Cryptocoryne wendtii', price: 9, level: 2, desc: 'Dalgalı kenarlı, kahve-yeşil yapraklı rozet. Gölgeyi sever, ön-orta plan için ideal.', o2: 0.7, uptake: 0.7 },
  ludwigia: { name: 'Ludwigia', latin: 'Ludwigia repens', price: 8, desc: 'Karşılıklı oval yapraklı gövde bitkisi; güçlü ışıkta tepeleri bakır-kırmızıya döner.', o2: 1.0, uptake: 1.2 },
  frogbit: { name: 'Amazon frogbit', latin: 'Limnobium laevigatum', price: 7, desc: 'Yüzen yuvarlak yapraklar ve sarkan tüylü kökler. Gölge yapar, nitratı hızla çeker.', o2: 0.5, uptake: 1.5 },
  sword: { name: 'Amazon kılıcı', latin: 'Echinodorus bleheri', price: 14, level: 3, desc: 'Geniş mızrak yapraklı iri rozet. Arka planda gösterişli bir odak noktası olur.', o2: 1.1, uptake: 1.1 },
};

// Bütün bitkiler prosedürel: tür biçimli yapraklar, damarlı doku, ışık geçirgenliği (leafPlants.js)
const PROC_PLANTS = {
  frogbit: buildFrogbit, ludwigia: buildLudwigia, sword: buildSword, crypt: buildCrypt,
  anubias: buildAnubias, javafern: buildJavafern, vallisneria: buildVallisneria,
};

export function createPlants(scene) {
  const group = new THREE.Group();
  const plants = [];

  function layout(plant) {
    plant.uHealth.value = plant.health;
    if (!plant.model) return;
    plant.model.position.set(plant.x, plant.y, plant.z);
    // yerleşim bir kez, tam boyuna göre yapılır: büyürken bitki yerinden kaymaz, camdan taşmaz
    if (!plant.fitted) {
      plant.model.scale.setScalar(1);
      plant.capK = fitPlant(plant);
      plant.fitted = true;
    }
    plant.model.scale.setScalar((0.55 + 0.45 * plant.growth) * plant.capK);
  }

  function add(type, x, z, { growth = 0.6, health = 1, seed = Math.floor(Math.random() * 1e9), y = null } = {}) {
    const r = mulberry(seed);
    const plant = { id: seed, type, x, z, y: y ?? sandHeight(x, z) - 0.3, growth, health, seed, leaves: [], extra: [], onSand: y == null };
    if (type === 'frogbit') plant.y = TANK.water + 0.04;
    plant.uHealth = { value: health };
    const uni = { uHealth: plant.uHealth, uPhase: { value: r() * 6.28 } };
    plant.model = PROC_PLANTS[type](seed, uni, { top: TANK.waterFull - 0.8 - plant.y });
    plant.model.rotation.y = r() * Math.PI * 2;
    group.add(plant.model);
    plant.extra.push(plant.model);
    layout(plant);
    plants.push(plant);
    return plant;
  }

  // Model bitki camdan taşmasın ve su yüzeyini delmesin: gerekirse içeri kaydır, boyunu sınırla
  const _box = new THREE.Box3();
  function fitPlant(plant) {
    const m = plant.model;
    m.updateMatrixWorld(true);
    _box.setFromObject(m);
    let capK = 1;
    if (plant.type !== 'frogbit') {
      const top = TANK.waterFull - 0.8;
      if (_box.max.y > top) {
        capK = Math.max(0.2, (top - plant.y) / (_box.max.y - plant.y));
        m.scale.multiplyScalar(capK);
        m.updateMatrixWorld(true);
        _box.setFromObject(m);
      }
    }
    plant.size = { h: _box.max.y - plant.y, r: Math.min(_box.max.x - _box.min.x, _box.max.z - _box.min.z) / 2 };
    const pad = plant.type === 'frogbit' ? 2 : 0.4;        // yüzen bitki sürüklenme payı
    const dx = Math.max(0, -HALF_W + pad - _box.min.x) - Math.max(0, _box.max.x - (HALF_W - pad));
    const dz = Math.max(0, -HALF_D + pad - _box.min.z) - Math.max(0, _box.max.z - (HALF_D - pad));
    if (dx || dz) {
      plant.x += dx; plant.z += dz;
      if (plant.onSand && plant.type !== 'frogbit') plant.y = sandHeight(plant.x, plant.z) - 0.3;
      m.position.set(plant.x, plant.y, plant.z);
      m.updateMatrixWorld(true);
    }
    return capK;
  }

  function remove(plant) {
    for (const o of plant.extra) group.remove(o);
    plants.splice(plants.indexOf(plant), 1);
  }

  scene.add(group);
  return { group, plants, add, remove, layout };
}
