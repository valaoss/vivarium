import { SPECIES, TRAIT_INFO, compatWarnings } from '../creatures/species.js';
import { PLANT_TYPES } from '../world/plants.js';
import { STATE_LABEL } from '../creatures/Fish.js';
import { SHRIMP_LABEL } from '../creatures/Shrimp.js';
import { SNAIL_LABEL } from '../creatures/Snail.js';
import { QUESTS, currentQuest } from '../game/quests.js';
import { quality } from '../sim/ecosystem.js';
import { REAL_FISH, realModelKey } from '../creatures/realModels.js';

const I = {
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  food: '<circle cx="7" cy="8" r="1.6"/><circle cx="13" cy="6" r="1.3"/><circle cx="17" cy="10" r="1.5"/><circle cx="10" cy="13" r="1.4"/><path d="M5 20c2-2 12-2 14 0"/>',
  wipe: '<path d="M4 17h16"/><path d="M7 17V9a5 5 0 0 1 10 0v8"/><path d="M12 4v-2"/>',
  water: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>',
  air: '<circle cx="8" cy="16" r="3"/><circle cx="15" cy="10" r="2.2"/><circle cx="11" cy="5" r="1.5"/>',
  light: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  camera: '<path d="M4 7h3l2-2h6l2 2h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
  shop: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  follow: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="M5 19c3-4 6-7 10-9"/>',
  pill: '<rect x="3" y="9" width="18" height="7" rx="3.5" transform="rotate(-35 12 12.5)"/><path d="M10 8.5l4 6"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  temp: '<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`;
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

export function createHUD(game, root, sound) {
  root.innerHTML = '';

  // ---- Üst bar ----
  const top = h(`
    <div class="topbar glass">
      <div class="clock"><span class="day"></span><span class="time"></span><span class="lt"></span></div>
      <div class="sep"></div>
      <div class="lvl" title="Doğa Seviyesi">${icon('leaf')}<span></span><div class="bar"><i></i></div></div>
      <div class="sep"></div>
      <div class="meter" data-k="q" title="Su kalitesi">${icon('water')}<div class="bar"><i></i></div></div>
      <div class="meter" data-k="o2" title="Oksijen">${icon('air')}<div class="bar"><i></i></div></div>
      <div class="temp" title="Sıcaklık">${icon('temp')}<span></span></div>
      <div class="sep"></div>
      <div class="coins" title="Bakım parası">${icon('coin')}<span></span></div>
    </div>`);
  root.appendChild(top);

  // ---- Görev kartı ----
  const quest = h(`<div class="quest glass"><div class="qhead"><span class="qtag">Görev <b></b></span><span class="qreward"></span></div><div class="qtitle"></div><div class="qdesc"></div><div class="qprog"><i></i></div></div>`);
  root.appendChild(quest);

  // ---- Araç çubuğu (sol alt) ----
  const tools = h(`
    <div class="tools glass">
      <button data-mode="view" title="Bak / incele">${icon('eye')}<span>Bak</span></button>
      <button data-mode="feed" title="Yem ver">${icon('food')}<span>Yem</span></button>
      <button data-mode="wipe" title="Camı sil">${icon('wipe')}<span>Cam sil</span></button>
      <button data-act="water" title="Su değiştir">${icon('water')}<span>Su değişimi</span></button>
      <button data-act="air" title="Hava taşı">${icon('air')}<span>Hava</span></button>
      <button data-act="light" title="Lamba">${icon('light')}<span>Işık</span></button>
    </div>`);
  root.appendChild(tools);

  const waterPop = h(`
    <div class="pop glass water-pop hidden">
      <div class="poptitle">Kısmi su değişimi</div>
      <div class="popdesc">Hortumla eski suyu çek, temiz su ekle. Atık ve nitrat azalır.</div>
      <input type="range" min="10" max="50" step="5" value="25" />
      <div class="poprow"><span class="pct">%25</span><span class="hint ok">İdeal aralık</span></div>
      <button class="primary">Değiştir</button>
    </div>`);
  root.appendChild(waterPop);

  // ---- Zaman (alt orta) ----
  const speed = h(`<div class="speed glass"><button data-s="1">1×</button><button data-s="4">4×</button><button data-s="16">16×</button></div>`);
  root.appendChild(speed);

  // ---- Sağ alt ----
  const right = h(`
    <div class="right-tools glass">
      <button data-act="shop">${icon('shop')}<span>Dükkân</span></button>
      <button data-act="photo">${icon('camera')}<span>Fotoğraf</span></button>
      <button data-act="sound">${icon('sound')}<span>Ses</span></button>
    </div>`);
  root.appendChild(right);

  const shop = h(`
    <div class="shop glass hidden">
      <div class="shophead"><div class="tabs"><button data-tab="creature" class="on">Canlılar</button><button data-tab="plant">Bitkiler</button></div><button class="x">${icon('close')}</button></div>
      <div class="items"></div>
    </div>`);
  root.appendChild(shop);

  // ---- Bilgi kartı ----
  const card = h(`
    <div class="card glass hidden">
      <div class="chead"><div><div class="cname"></div><div class="csp"></div></div><div class="mood"></div></div>
      <div class="cstate"></div>
      <div class="cdisease hidden"><span></span><button class="treat">${icon('pill', 'sm')}<span>Tedavi et · 12</span></button></div>
      <div class="cbars">
        <label>Tokluk</label><div class="bar"><i data-b="food"></i></div>
        <label>Sağlık</label><div class="bar"><i data-b="health"></i></div>
        <label>Huzur</label><div class="bar"><i data-b="calm"></i></div>
      </div>
      <div class="ctrait"></div>
      <div class="cbtns"><button class="follow">${icon('follow')}<span>Takip et</span></button><button class="x">${icon('close')}</button></div>
    </div>`);
  root.appendChild(card);

  const toasts = h('<div class="toasts"></div>');
  root.appendChild(toasts);

  const modeHint = h('<div class="mode-hint hidden"></div>');
  root.appendChild(modeHint);

  const photoUI = h(`
    <div class="photo-ui hidden">
      <div class="photo-hint">Sürükle: döndür · Tekerlek: yakınlaş · Balığa dokun: odakla · Boşluk: çek · Esc: çık</div>
      <button class="shutter" title="Fotoğraf çek"></button>
      <button class="photo-exit">${icon('close')}</button>
    </div>`);
  root.appendChild(photoUI);

  const flash = h('<div class="flash"></div>');
  root.appendChild(flash);

  // ---- Davranış ----
  tools.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    game.setMode(b.dataset.mode);
    waterPop.classList.add('hidden');
  }));
  tools.querySelector('[data-act="water"]').addEventListener('click', () => {
    waterPop.classList.toggle('hidden');
    shop.classList.add('hidden');
  });
  const range = waterPop.querySelector('input');
  const syncRange = () => {
    const v = +range.value;
    waterPop.querySelector('.pct').textContent = `%${v}`;
    const hint = waterPop.querySelector('.hint');
    hint.textContent = v <= 30 ? 'İdeal aralık' : 'Ani değişim stres yaratır';
    hint.className = 'hint ' + (v <= 30 ? 'ok' : 'warn');
  };
  range.addEventListener('input', syncRange);
  waterPop.querySelector('.primary').addEventListener('click', () => {
    game.doWaterChange(+range.value / 100);
    waterPop.classList.add('hidden');
  });
  tools.querySelector('[data-act="air"]').addEventListener('click', () => {
    game.state.airstone = !game.state.airstone;
    game.toast(game.state.airstone ? 'Hava taşı açıldı.' : 'Hava taşı kapatıldı. Oksijen yavaşça düşebilir.');
  });
  tools.querySelector('[data-act="light"]').addEventListener('click', () => game.toggleLight());

  speed.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { game.speed = +b.dataset.s; }));

  let shopTab = 'creature';
  const renderShop = () => {
    shop.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('on', t.dataset.tab === shopTab));
    const items = shop.querySelector('.items');
    items.innerHTML = '';
    const list = shopTab === 'creature' ? Object.entries(SPECIES) : Object.entries(PLANT_TYPES);
    for (const [key, it] of list) {
      const locked = shopTab === 'creature' && !game.isUnlocked(key);
      const unlockQuest = QUESTS.find((q) => q.unlock === key);
      const lockText = [it.level ? `Doğa Seviyesi ${it.level}` : '', unlockQuest ? `“${unlockQuest.title}” görevi` : ''].filter(Boolean).join(' veya ');
      const warns = shopTab === 'creature' && !locked ? compatWarnings(key, game.counts()) : [];
      const el = h(`
        <div class="item ${locked ? 'locked' : ''}">
          <div class="swatch sw-${key}"></div>
          <div class="info">
            <div class="iname">${it.name}${it.latin ? ` <i>${it.latin}</i>` : ''}</div>
            <div class="idesc">${locked ? `${icon('lock', 'sm')} ${lockText} ile açılır.` : it.desc}</div>
            ${warns.map((w) => `<div class="iwarn">${icon('warn', 'sm')} ${w}</div>`).join('')}
          </div>
          <button class="buy" ${locked ? 'disabled' : ''}>${icon('coin', 'sm')}${it.price}</button>
        </div>`);
      el.querySelector('.buy').addEventListener('click', (ev) => {
        const btn = ev.currentTarget;
        // uyumsuz türlerde ikinci tıklamayla onay
        if (warns.some((w) => !w.includes('sürü balığıdır')) && !btn.dataset.ok) {
          btn.dataset.ok = '1';
          btn.innerHTML = 'Yine de al';
          btn.classList.add('confirm');
          return;
        }
        if (game.buy(shopTab === 'creature' ? 'creature' : 'plant', key)) {
          if (shopTab === 'plant') shop.classList.add('hidden');
          renderShop();
        }
      });
      items.appendChild(el);
    }
  };
  shop.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => { shopTab = t.dataset.tab; renderShop(); }));
  shop.querySelector('.x').addEventListener('click', () => shop.classList.add('hidden'));
  right.querySelector('[data-act="shop"]').addEventListener('click', () => {
    shop.classList.toggle('hidden');
    waterPop.classList.add('hidden');
    renderShop();
  });
  right.querySelector('[data-act="photo"]').addEventListener('click', () => game.setPhoto(true));
  const soundBtn = right.querySelector('[data-act="sound"]');
  const syncSound = () => { soundBtn.innerHTML = `${icon(sound.muted ? 'mute' : 'sound')}<span>${sound.muted ? 'Sessiz' : 'Ses'}</span>`; };
  soundBtn.addEventListener('click', () => { sound.start(); sound.setMuted(!sound.muted); syncSound(); });
  syncSound();
  // arayüz düğmelerinde hafif tık sesi
  root.addEventListener('click', (e) => { if (e.target.closest('button')) sound.play('click'); });
  photoUI.querySelector('.shutter').addEventListener('click', () => doCapture());
  photoUI.querySelector('.photo-exit').addEventListener('click', () => game.setPhoto(false));
  const doCapture = () => {
    game.capture();
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
  };
  window.addEventListener('keydown', (e) => { if (e.key === ' ' && game.photo) flash.classList.remove('go'), void flash.offsetWidth, flash.classList.add('go'); });

  card.querySelector('.x').addEventListener('click', () => game.select(null));
  card.querySelector('.treat').addEventListener('click', () => { game.treat(game.selected); updateCard(false); });
  card.querySelector('.follow').addEventListener('click', () => {
    game.follow = !game.follow;
    card.querySelector('.follow span').textContent = game.follow ? 'Takibi bırak' : 'Takip et';
  });

  const MODE_HINTS = {
    feed: 'Su yüzeyine dokunarak yem bırak. Az ve sık beslemek en iyisidir.',
    wipe: 'Ön camın üzerinde sürükleyerek yosunu sil.',
    plant: 'Bitkiyi dikmek için kumun üzerine dokun. Esc: vazgeç',
  };
  game.on('mode', (m) => {
    tools.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    const key = m.startsWith('plant:') ? 'plant' : m;
    modeHint.textContent = MODE_HINTS[key] ?? '';
    modeHint.classList.toggle('hidden', !MODE_HINTS[key]);
  });
  game.on('select', (c) => {
    card.classList.toggle('hidden', !c);
    card.querySelector('.follow span').textContent = 'Takip et';
    if (c) updateCard(true);
  });
  game.on('photo', (on) => {
    root.classList.toggle('photo-mode', on);
    photoUI.classList.toggle('hidden', !on);
  });
  game.on('toast', ({ text, kind }) => {
    const t = h(`<div class="toast glass ${kind}">${text}</div>`);
    toasts.appendChild(t);
    while (toasts.children.length > 4) toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), kind === 'discover' ? 7000 : 4500);
    setTimeout(() => t.remove(), kind === 'discover' ? 7600 : 5100);
  });
  game.on('quest', ({ done, next }) => {
    game.toast(`Görev tamamlandı: “${done.title}” · +${done.reward} bakım parası`, 'good');
    quest.classList.add('pulse');
    setTimeout(() => quest.classList.remove('pulse'), 900);
    renderQuest();
    if (!shop.classList.contains('hidden')) renderShop();
    void next;
  });

  const renderQuest = () => {
    const q = currentQuest(game.state);
    if (!q) {
      quest.querySelector('.qtag b').textContent = '';
      quest.querySelector('.qtitle').textContent = 'Tüm görevler tamam!';
      quest.querySelector('.qdesc').textContent = 'Akvaryumun artık kendi dengesinde. Yeni habitatlar yakında…';
      quest.querySelector('.qreward').textContent = '';
      quest.querySelector('.qprog').style.display = 'none';
      return;
    }
    quest.querySelector('.qtag b').textContent = `${game.state.questIndex + 1}/${QUESTS.length}`;
    quest.querySelector('.qtitle').textContent = q.title;
    quest.querySelector('.qdesc').textContent = q.desc;
    quest.querySelector('.qreward').innerHTML = `${icon('coin', 'sm')}+${q.reward}`;
    quest.querySelector('.qprog').style.display = q.progress ? '' : 'none';
  };
  renderQuest();

  const MOOD = (d) => {
    const score = d.health * 0.5 + (100 - d.hunger) * 0.25 + (100 - d.stress) * 0.25;
    if (score > 72) return ['☺', 'Mutlu', 'good'];
    if (score > 50) return ['◡', 'Huzursuz', 'mid'];
    return ['☹', 'Kötü durumda', 'bad'];
  };
  const updateCard = (full) => {
    const c = game.selected;
    if (!c) return;
    const d = c.data;
    const sp = SPECIES[d.species];
    if (full) {
      card.querySelector('.cname').textContent = d.name;
      card.querySelector('.csp').innerHTML = `${sp.name} · <i>${sp.latin}</i>`;
      const rk = realModelKey(d.species, d.sex);
      const credit = rk ? `<br><span class="muted credit">3D model: ${REAL_FISH[rk].credit}</span>` : '';
      card.querySelector('.ctrait').innerHTML = `<b>${d.trait}</b> — ${TRAIT_INFO[d.trait] ?? ''}<br><span class="muted">Beslenme: ${sp.diet}</span>${credit}`;
    }
    const st = (STATE_LABEL[c.state] ?? SHRIMP_LABEL[c.state] ?? SNAIL_LABEL[c.state]) ?? '';
    const dz = card.querySelector('.cdisease');
    dz.classList.toggle('hidden', !d.ich);
    if (d.ich) {
      dz.querySelector('span').textContent = d.treating ? `Beyaz benek · tedavi ediliyor (%${Math.round(d.ich * 100)})` : `Beyaz benek hastalığı (%${Math.round(d.ich * 100)})`;
      dz.querySelector('.treat').classList.toggle('hidden', !!d.treating);
    }
    card.querySelector('.cstate').textContent = st;
    card.querySelector('[data-b="food"]').style.width = `${100 - d.hunger}%`;
    card.querySelector('[data-b="health"]').style.width = `${d.health}%`;
    card.querySelector('[data-b="calm"]').style.width = `${100 - d.stress}%`;
    const [face, label, cls] = MOOD(d);
    const m = card.querySelector('.mood');
    m.textContent = face; m.title = label; m.className = 'mood ' + cls;
  };

  // ---- Periyodik güncelleme ----
  let acc = 0;
  return {
    update(dt) {
      acc += dt;
      if (acc < 0.2) return;
      acc = 0;
      const s = game.state;
      const hh = Math.floor(game.hour), mm = Math.floor((game.hour % 1) * 60);
      top.querySelector('.day').textContent = `Gün ${game.day}`;
      top.querySelector('.time').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      top.querySelector('.lt').innerHTML = game.lightOn() ? icon('sun', 'sm') : icon('moon', 'sm');
      const q = quality(s.water);
      const setMeter = (k, v) => {
        const el = top.querySelector(`[data-k="${k}"]`);
        el.querySelector('i').style.width = `${v}%`;
        el.classList.toggle('warn', v < 60);
        el.classList.toggle('bad', v < 40);
        el.title = (k === 'q' ? 'Su kalitesi ' : 'Oksijen ') + Math.round(v);
      };
      setMeter('q', q);
      setMeter('o2', s.water.o2);
      top.querySelector('.temp span').textContent = `${s.water.temp.toFixed(1)}°C`;
      top.querySelector('.coins span').textContent = s.coins;
      top.querySelector('.lvl span').textContent = `Sv ${game.level}`;
      top.querySelector('.lvl i').style.width = `${Math.round(game.levelProgress() * 100)}%`;
      tools.querySelector('[data-act="air"]').classList.toggle('on', s.airstone);
      tools.querySelector('[data-act="light"]').classList.toggle('on', game.lightOn());
      speed.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.s === game.speed));
      const qd = currentQuest(s);
      if (qd?.progress) quest.querySelector('.qprog i').style.width = `${Math.min(100, qd.progress(game) * 100)}%`;
      updateCard(false);
    },
    showWelcome(text, first) {
      const el = h(`
        <div class="welcome">
          <div class="wbox glass">
            <div class="wlogo">VIVARIUM</div>
            <div class="wtag">Küçük bir akvaryumla başla, canlılarını tanı, doğanın dengesini öğren.</div>
            ${text ? `<div class="wmsg">${text}</div>` : ''}
            ${first ? '<div class="wmsg">İki lepistes, birkaç bitki ve bir hava taşı seni bekliyor. Sol üstteki görevleri takip et.</div>' : ''}
            <button class="primary">${first ? 'Başla' : 'Devam et'}</button>
          </div>
        </div>`);
      root.appendChild(el);
      el.querySelector('button').addEventListener('click', () => { el.classList.add('out'); setTimeout(() => el.remove(), 600); });
    },
  };
}
