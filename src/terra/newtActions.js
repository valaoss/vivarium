import * as THREE from 'three';
import { curve } from '../eco/Brain.js';

// Kırmızı karınlı semenderin (Cynops pyrrhogaster) davranış repertuvarı.
// Her eylem yalnızca semenderin ihtiyaçlarına, algıladıklarına ve hafızasına bakar.

const _v = new THREE.Vector3();
const pick = (n, a, b) => a + n.rand() * (b - a);

// ------------------------------------------------------------------ dinlenme: gündüz kuytuda, suda dipte
const rest = {
  id: 'rest', label: 'Dinleniyor',
  score(n) {
    const N = n.needs;
    let v = 0.25 + (n.world.night ? 0 : 0.25) + curve.lin(N.fatigue, 30, 90) * 0.3 + curve.lin(N.energy, 60, 100) * 0.15;
    if (n.world.temperature > 24) v += 0.15;                     // sıcakta hareketsiz, serin dipte
    v *= 1 - curve.lin(100 - N.energy, 40, 90) * 0.6;          // açken dinlenme isteği azalır
    v *= 1 - n.restless * 0.55;                                 // uzun süre kıpırdamadıysa huzursuzlanır
    return [v * (1.15 - n.traits.activity * 0.3), `${n.world.night ? 'gece' : 'gündüz: ışıkta daha az etkin'}; tokluk ${N.energy | 0}${n.world.temperature > 24 ? '; su ılık, serinde bekliyor' : ''}`];
  },
  start(n) {
    // suda mı karada mı dinlenecek: kişilik + nem + sıcaklık
    const land = n.rand() < n.traits.terrestrial * (n.world.humidity / 100) && n.world.temperature < 24 && n.needs.moisture > 60;
    const site = n.recall(land ? 'shelter' : 'pool', (m) => m.value - m.pos.distanceTo(n.pos) * 0.03 + n.rand() * 0.3);
    n.restAt = site ? site.pos.clone().add(_v.set(pick(n, -2, 2), 0, pick(n, -2, 2))) : null;
    n.fidget = pick(n, 15, 50); n.restT = 0;
  },
  tick(n, dt) {
    if (n.restAt && n.goTo(n.restAt, n.inWater ? 2.6 : 1.4, 1.8) > 1.8) { n.note = 'Dinlenme yerine gidiyor'; return 'run'; }
    n.restAt = null;
    n.halt(n.inWater ? 'bottom' : 'rest');
    n.restT += dt;
    if (n.restT > n.fidget) { n.restT = 0; n.fidget = pick(n, 20, 60); n.nudge = pick(n, -0.8, 0.8); }
    if (n.nudge) {
      const step = Math.sign(n.nudge) * Math.min(Math.abs(n.nudge), dt * 0.5);
      const angle = n.heading + step;
      n.face(_v.set(n.pos.x + Math.sin(angle) * 3, n.pos.y, n.pos.z + Math.cos(angle) * 3));
      n.nudge -= step;
      if (Math.abs(n.nudge) < 0.01) n.nudge = 0;
    }
    n.note = n.inWater ? 'Dipte hareketsiz; gırtlağı nefesle inip kalkıyor' : 'Kuytuda hareketsiz';
    return 'run';
  },
};

// ------------------------------------------------------------------ yiyecek arama (koklayarak)
const forage = {
  id: 'forage', label: 'Yiyecek arıyor',
  score(n) {
    let v = curve.lin(100 - n.needs.energy, 20, 80) * (n.world.night ? 0.75 : 0.5) + n.traits.activity * 0.1;
    if (n.prey) v *= 0.3; else if (n.odor) v *= 0.5;           // yer belli ya da koku var: rastgele aramaya gerek yok
    return [v, `açlık ${(100 - n.needs.energy) | 0}; ${n.world.night ? 'gece arayışı' : 'gündüz'}`];
  },
  start(n) { n.fg = { goal: chooseForageGoal(n), pause: 0 }; },
  tick(n, dt) {
    const F = n.fg;
    F.pause -= dt;
    if (F.pause > 0) { n.halt(n.inWater ? 'cruise' : 'rest'); n.sniffing = 1; n.note = 'Durdu; başını iki yana çevirip kokluyor'; return 'run'; }
    n.sniffing = 0.4;
    if (n.goTo(F.goal, n.inWater ? 2.4 : 1.2, 2) < 2) { F.goal = chooseForageGoal(n); F.pause = pick(n, 2, 6); }
    if (n.rand() < dt * 0.08) F.pause = pick(n, 1.5, 4);
    n.note = n.inWater ? 'Dibe yakın yavaşça süzülüyor, burnuyla yokluyor' : 'Toprağı koklayarak yürüyor';
    return 'run';
  },
  end(n) { n.sniffing = 0; },
};

function chooseForageGoal(n) {
  // önce yiyecek bulduğu yerler, sonra rastgele; su/kara tercihi kişiliğe bağlı
  const fs = n.recall('food', (m) => m.value - m.pos.distanceTo(n.pos) * 0.02 + n.rand() * 0.4);
  if (fs && n.rand() < 0.5) return fs.pos.clone().add(_v.set(pick(n, -4, 4), 0, pick(n, -4, 4)));
  return n.randomSpot(n.rand() > n.traits.terrestrial * 0.8);
}

// ------------------------------------------------------------------ koku izi (klinotaksi: iki yandaki koku farkına göre dönerek)
const trackOdor = {
  id: 'track', label: 'Kokunun peşinde',
  when: (n) => n.odor && !n.prey,
  score(n) {
    const v = Math.min(1, n.odor.conc * 5) * (0.3 + curve.lin(100 - n.needs.energy, 10, 70) * 0.65);
    return [v, `yiyecek kokusu (yoğunluk ${(n.odor.conc * 100) | 0}); kaynağı görmüyor`];
  },
  start(n) { n.tk = { t: 0, best: n.odor.conc, flat: 0 }; },
  tick(n, dt) {
    const T = n.tk; T.t += dt;
    const o = n.odor;
    if (!o) { n.note = 'Koku kayboldu'; return 'fail'; }
    // koku hangi yanda daha güçlüyse o yana döner; artmıyorsa genişçe zikzak
    n.halt(n.inWater ? 'cruise' : 'walk');
    n.mv.speed = n.inWater ? 1.4 : 0.8;
    n.heading += THREE.MathUtils.clamp(o.side * 4, -1, 1) * dt * 1.4 + Math.sin(T.t * 1.7) * dt * 0.5;
    if (o.conc > T.best) { T.best = o.conc; T.flat = 0; } else T.flat += dt;
    n.sniffing = 1;
    n.note = `Kokuya doğru ${o.side > 0.02 ? 'sola' : o.side < -0.02 ? 'sağa' : 'düz'} kıvrılıyor (yoğunluk ${(o.conc * 100) | 0})`;
    return T.flat > 25 ? 'fail' : 'run';
  },
  end(n) { n.sniffing = 0; },
};

// ------------------------------------------------------------------ av: yönel → yaklaş → kilitlen → atak → yut
const hunt = {
  id: 'hunt', label: 'Avlanıyor', emergency: true,
  when: (n) => !!n.prey || !!n.ht,
  score(n) {
    // av anlık algılanmıyorsa son bilinen konumla devam (kısa süreli bellek)
    if (!n.prey) return [Math.max(0, 0.7 - n.ht.lost * 0.1), `av gözden kayboldu, son görüldüğü yere bakıyor (${n.ht.lost.toFixed(1)} s)`];
    const p = n.prey;
    const d = p.pos.distanceTo(n.headPos(_v));
    const v = Math.min(1, 0.4 + curve.lin(100 - n.needs.energy, 5, 60) * 0.55) * Math.sqrt(p.conf) * (d < 25 ? 1 : 0.5);
    return [v, `${p.e.label ?? 'av'}: ${[...p.senses].join(' + ')}, ${d.toFixed(1)} cm`];
  },
  lock: (n) => n.ht && (n.ht.stage === 'strike' || n.ht.stage === 'swallow'),
  inertia: 1.4,
  start(n) { n.ht = { e: n.prey.e, pos: n.prey.pos.clone(), stage: 'approach', t: 0, lost: 0, tries: 0 }; n.target = { pos: n.ht.pos, kind: 'av' }; },
  tick(n, dt) {
    const H = n.ht; H.t += dt;
    const p = n.percepts.get(H.e.id);
    if (p && p.conf > 0.1) { H.pos.copy(p.pos); H.lost = 0; } else H.lost += dt;
    if ((H.e.eaten || H.e.alive === false) && !H.caught) return 'fail';
    if (H.lost > 6 && H.stage === 'approach') { n.note = 'Avı gözden kaçırdı'; return 'fail'; }
    const head = n.headPos(_v);
    const d = Math.hypot(H.pos.x - head.x, H.pos.z - head.z);
    const ang = Math.abs(n.angleTo(H.pos));
    if (H.stage === 'approach') {
      // yavaş, sabit yaklaşma; son 5 cm'de daha da yavaşlar
      n.goTo(H.pos, n.inWater ? (d > 5 ? 3 : 1) : (d > 5 ? 1.3 : 0.45), 0);
      n.state = 'stalk';
      n.note = `Avına sokuluyor (${d.toFixed(1)} cm)`;
      if (d < 1.7 && ang < 0.3) { H.stage = 'fix'; H.t = 0; }
      if (H.t > 60) return 'fail';
      return 'run';
    }
    if (H.stage === 'fix') {
      // başını hedefe kilitler, kısa bir duraksama
      n.face(H.pos); n.state = 'stalk';
      n.note = 'Kımıldamadan bakıyor; hedefe kilitlendi';
      if (H.t > 0.3 + (1 - n.traits.boldness) * 0.6) { H.stage = 'strike'; H.t = 0; n.strikeT = 0; }
      return 'run';
    }
    if (H.stage === 'strike') {
      // suda emerek, karada dil ve çeneyle ani atak
      n.state = 'strike'; n.strikeT = H.t; n.mv.speed = H.t < 0.15 ? 9 : 0;
      n.note = n.inWater ? 'Ağzını açıp suyla birlikte avı emiyor' : 'Ani atak: çene ve dil';
      if (H.t > 0.12 && !H.resolved) {
        H.resolved = true;
        const moving = (H.e.speed ?? 0) > 0.1;
        const chance = (d < 1.9 ? 0.85 : 0.45) * (moving ? 0.8 : 1) * (n.inWater ? 1 : 0.85);
        if (n.rand() < chance && !H.e.eaten) {
          n.world.eat(H.e);
          H.caught = true;
          n.remember('food', H.pos, 0.8, 4);
          n.learnFeeding(H.pos);
        }
      }
      if (H.t > 0.45) {
        if (H.caught) { H.stage = 'swallow'; H.t = 0; n.needs.energy = Math.min(100, n.needs.energy + (H.e.food ?? 30)); n.note = 'Yakaladı'; }
        else if (++H.tries < 3) { H.stage = 'fix'; H.t = 0; H.resolved = false; n.note = 'Iskaladı; yeniden hedefliyor'; }
        else return 'fail';
      }
      return 'run';
    }
    // yutma: uzun solucanı baş sallayarak, yutkunarak iner
    n.state = 'swallow'; n.halt(n.inWater ? 'cruise' : 'rest'); n.state = 'swallow';
    n.headShake = H.e.kind === 'worm' ? Math.max(0, 1 - H.t / 2.5) : 0;
    n.swallowT = H.t;
    n.note = H.e.kind === 'worm' ? 'Solucanı başını sallayarak yutuyor' : 'Yutuyor';
    return H.t > 3 ? 'done' : 'run';
  },
  end(n) { n.ht = null; n.target = null; n.headShake = 0; n.state = n.inWater ? 'swim' : 'walk'; },
};

// ------------------------------------------------------------------ yüzeyden hava alma (akciğer solunumu)
const breathe = {
  id: 'breathe', label: 'Hava almaya çıkıyor', emergency: true,
  when: (n) => n.inWater,
  score(n) {
    const o = n.needs.oxygen;
    return [o < 12 ? 1 : curve.inv(o, 15, 45) * 0.9, `oksijen ${o | 0}${o < 12 ? ': acil' : ''}`];
  },
  lock: (n) => n.needs.oxygen < 60 && n.inWater,
  start(n) { n.br = { t: 0, gulps: 0 }; },
  tick(n, dt) {
    const B = n.br;
    n.halt('surface');
    n.mv.speed = n.pos.y < n.world.waterY - 1.2 ? 1.6 : 0.2;
    n.state = 'air';
    if (n.pos.y > n.world.waterY - 0.8) {
      B.t += dt;
      // her yutkunmada akciğer dolar; ağız kenarında küçük hava kabarcığı
      if (B.t > 1.1) { B.t = 0; B.gulps++; n.needs.oxygen = Math.min(100, n.needs.oxygen + 35); n.world.ripple?.(n.headPos(_v), 0.3); }
      n.note = `Burnunu sudan çıkarıp hava yutuyor (${B.gulps})`;
    } else n.note = 'Yüzeye doğru yükseliyor';
    return n.needs.oxygen > 95 ? 'done' : 'run';
  },
  end(n) { n.state = 'swim'; },
};

// ------------------------------------------------------------------ deri nemi: karada kuruyunca suya döner
const moisten = {
  id: 'moisten', label: 'Nemlenmek için suya dönüyor',
  when: (n) => !n.inWater,
  score(n) { return [curve.inv(n.needs.moisture, 25, 60) * 0.9, `deri nemi ${n.needs.moisture | 0}; ortam nemi %${n.world.humidity | 0}`]; },
  start(n) { const p = n.recall('pool', (m) => -m.pos.distanceTo(n.pos)); n.mo = p ? p.pos.clone() : n.randomSpot(true); },
  tick(n) {
    n.goTo(n.mo, 1.6, 1.5);
    n.note = 'Derisi kuruyor; suya yürüyor';
    return n.inWater ? 'done' : 'run';
  },
};

// ------------------------------------------------------------------ deri değiştirme: sürtünür, sıyrılır, deriyi yer
const shed = {
  id: 'shed', label: 'Deri değiştiriyor',
  when: (n) => n.data.shed >= 1,
  score() { return [0.8, 'eski deri gevşedi']; },
  lock: (n) => !!n.sh && n.sh.stage !== 'rub',
  start(n) { n.sh = { stage: 'rub', t: 0 }; },
  tick(n, dt) {
    const S = n.sh; S.t += dt;
    if (S.stage === 'rub') {
      // burnunu ve çenesini zemine sürterek deriyi ağız kenarından gevşetir
      n.halt(n.inWater ? 'bottom' : 'rest'); n.state = 'shed'; n.shedPhase = S.t;
      n.note = 'Çenesini zemine sürtüyor; deri ağız kenarından ayrılıyor';
      if (S.t > 14) { S.stage = 'peel'; S.t = 0; S.skin = n.world.onNewtShed?.(n); }
      return 'run';
    }
    if (S.stage === 'peel') {
      // gövdeyi kıvırıp öne yürüyerek deriden sıyrılır
      n.state = n.inWater ? 'swim' : 'walk';
      n.mv.speed = 0.5; n.mv.to = null; n.mv.depth = 'bottom';
      S.skin?.userData.peel?.(dt);
      n.note = 'Deriden yavaşça sıyrılıyor';
      if (S.t > 8) { S.stage = 'eat'; S.t = 0; }
      return 'run';
    }
    // dönüp eski derisini yer (besin geri kazanımı)
    if (S.skin) {
      const sp = S.skin.position;
      n.face(sp);
      if (Math.abs(n.angleTo(sp)) < 0.3) { n.state = 'swallow'; n.swallowT = S.t; n.headShake = 0.4; S.skin.userData.eat?.(dt); }
    }
    n.note = 'Eski derisini yutuyor';
    if (S.t > 10) { S.skin?.userData.done?.(); n.data.shed = 0; n.needs.energy = Math.min(100, n.needs.energy + 4); return 'done'; }
    return 'run';
  },
  end(n) { n.sh = null; n.headShake = 0; },
};

// ------------------------------------------------------------------ savunma
const unken = {
  id: 'unken', label: 'Unken refleksi', emergency: true,
  when: (n) => !n.inWater && !!n.threat,
  score(n) {
    const d = n.threat.pos.distanceTo(n.pos);
    return [d < 5 ? Math.min(1, n.threatLevel + 0.4) : 0, 'karada çok yakın tehdit: sırtını büküp turuncu karnını gösterir (zehir uyarısı)'];
  },
  lock: (n) => n.un && n.un.t < 4,
  start(n) { n.un = { t: 0 }; },
  tick(n, dt) {
    n.un.t += dt; n.halt('rest'); n.state = 'unken';
    n.note = 'Baş ve kuyruk yukarı, karın görünüyor; kımıldamıyor';
    return n.un.t > 6 + n.rand() * 6 && n.threatLevel < 0.2 ? 'done' : 'run';
  },
  end(n) { n.un = null; },
};

const flee = {
  id: 'flee', label: 'Kaçıyor', emergency: true,
  when: (n) => !!n.threat,
  score(n) { return [Math.min(1, n.threatLevel * (1.2 - n.traits.boldness * 0.5)), n.threat.why ?? 'tehdit']; },
  start(n) {
    // suda: derine ve kuytuya; karada: suya
    const pool = n.recall('pool', (m) => -m.pos.distanceTo(n.pos) + m.pos.distanceTo(n.threat.pos) * 0.5);
    n.fl = { to: pool ? pool.pos.clone() : n.randomSpot(true), t: 0 };
  },
  tick(n, dt) {
    n.fl.t += dt;
    const d = n.goTo(n.fl.to, n.inWater ? 6 : 2.6, 1.5);
    n.mv.depth = 'bottom';
    n.note = n.inWater ? 'Hızla dibe, kuytuya yüzüyor' : 'Suya doğru kaçıyor';
    return d < 1.5 || n.fl.t > 12 ? 'done' : 'run';
  },
};

// ------------------------------------------------------------------ öğrenilmiş beklenti: yem saati yaklaşınca yem yerine gelir
const anticipate = {
  id: 'anticipate', label: 'Yem saatini bekliyor',
  score(n) {
    const k = n.feedExpectation();
    return [k * curve.lin(100 - n.needs.energy, 25, 70) * 0.75, `genelde bu saatlerde yem geliyor (beklenti ${(k * 100) | 0}%)`];
  },
  start(n) { const f = n.recall('feedSpot'); n.an = f ? f.pos.clone() : null; },
  tick(n) {
    if (!n.an) return 'fail';
    if (n.goTo(n.an, n.inWater ? 2.4 : 1.2, 3) > 3) { n.note = 'Yemin genelde düştüğü yere gidiyor'; return 'run'; }
    n.halt(n.inWater ? 'cruise' : 'rest');
    n.lookUp = 1;
    n.note = 'Yem yerinde, yukarı bakarak bekliyor';
    return 'run';
  },
  end(n) { n.lookUp = 0; },
};

// ------------------------------------------------------------------ keşif / yer değiştirme (karaya çıkma, suya dönme)
const explore = {
  id: 'explore', label: 'Geziniyor',
  score(n) {
    const v = (n.world.night ? 0.38 : 0.18) * (0.6 + n.traits.activity * 0.8) + n.restless * 0.25;
    return [v, `${n.world.night ? 'gece: daha hareketli' : 'gündüz gezintisi'}${n.restless > 0.5 ? '; uzun süredir kıpırdamadı' : ''}`];
  },
  start(n) {
    n.ex = n.randomSpot(n.rand() > n.traits.terrestrial);
    n.exMoveT = pick(n, 5, 14);
    n.exPause = 0;
  },
  tick(n, dt) {
    if (n.exPause > 0) {
      n.exPause -= dt;
      n.halt(n.inWater ? 'cruise' : 'rest');
      n.note = 'Kısa süre durup çevresini kontrol ediyor';
      return 'run';
    }
    n.exMoveT -= dt;
    if (n.exMoveT <= 0) { n.exPause = pick(n, 1, 4); n.exMoveT = pick(n, 5, 14); }
    const d = n.goTo(n.ex, n.inWater ? 3.5 : 1.6, 2);
    n.note = n.inWater ? 'Göletin içinde dolaşıyor' : 'Karada yavaşça yürüyor';
    return d < 2 ? 'done' : 'run';
  },
};

export const NEWT_ACTIONS = [rest, forage, trackOdor, hunt, breathe, moisten, shed, unken, flee, anticipate, explore];
