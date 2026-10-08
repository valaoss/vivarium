import { icon, h } from '../ui/hud.js';
import { createObserver } from './observer.js';

export function createTerraHUD(terra, root) {
  root.innerHTML = '';

  const top = h(`
    <div class="topbar glass">
      <div class="clock"><span class="day"></span><span class="time"></span><span class="lt"></span></div>
      <div class="sep"></div>
      <div class="meter" data-k="hum" title="Nem">${icon('drop')}<div class="bar"><i></i></div><span class="pct"></span></div>
      <div class="temp" title="Sıcaklık">${icon('temp')}<span></span></div>
    </div>`);
  root.appendChild(top);

  const dock = h('<div class="dock glass"></div>');
  const tools = h(`
    <div class="tools">
      <button data-mode="view">${icon('eye')}<span>Bak</span></button>
      <button data-mode="feed">${icon('food')}<span>Solucan</span></button>
      <button data-act="mist">${icon('mist')}<span>Sis</span></button>
    </div>`);
  const right = h(`
    <div class="right-tools">
      <button data-act="observe">${icon('scope')}<span>Gözlem</span></button>
      <button data-act="aqua">${icon('fish')}<span>Akvaryum</span></button>
    </div>`);
  dock.append(tools, h('<div class="dock-sep"></div>'), right);
  root.appendChild(dock);

  const card = h(`
    <div class="card glass hidden">
      <div class="chead"><div><div class="cname"></div><div class="csp">Kırmızı karınlı semender · <i>Cynops pyrrhogaster</i></div></div></div>
      <div class="cstate"></div>
      <div class="cbars"><label>Tokluk</label><div class="bar"><i data-b="food"></i></div></div>
      <div class="ctrait">Japonya'nın serin derelerinde yaşar. Sırtı koyu kahve, karnı alev turuncusu ve siyah beneklidir; bu renk avcılara “zehirliyim” der. Gününün çoğunu suda geçirir, ara ara yüzeye çıkıp hava yutar. Avını hareketinden ve kokusundan bulur, yavaşça yaklaşıp ani bir atakla yakalar.</div>
      <div class="cbtns"><button class="x">${icon('close')}</button></div>
    </div>`);
  root.appendChild(card);
  const toasts = h('<div class="toasts"></div>');
  root.appendChild(toasts);
  const hint = h('<div class="mode-hint hidden"></div>');
  root.appendChild(hint);
  const obs = createObserver(terra, root);

  const setMode = (m) => {
    terra.mode = m;
    tools.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    hint.textContent = m === 'feed' ? 'Toprağa ya da suya dokunarak solucan bırak' : '';
    hint.classList.toggle('hidden', m !== 'feed');
  };
  setMode('view');
  tools.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  tools.querySelector('[data-act="mist"]').addEventListener('click', () => {
    terra.spray();
    terra.toast(terra.state.humidity > 92 ? 'Nem çok yükseldi; camlar buğulandı. Biraz havalanmasını bekle.' : 'Bitkilere ve yosuna ince sis püskürttün.');
  });
  right.querySelector('[data-act="aqua"]').addEventListener('click', () => {
    terra.save();
    try { localStorage.setItem('vivarium.habitat', 'aqua'); } catch { /* yok */ }
    location.reload();
  });

  right.querySelector('[data-act="observe"]').addEventListener('click', (e) => { obs.toggle(); e.currentTarget.classList.toggle('on', obs.on); card.classList.toggle('hidden', obs.on || !selected); });
  let selected = null;
  terra.on('select', (n) => { selected = n; card.classList.toggle('hidden', !n || obs.on); });
  card.querySelector('.x').addEventListener('click', () => { selected = null; card.classList.add('hidden'); });
  terra.on('toast', ({ text, kind }) => {
    const t = h(`<div class="toast glass ${kind}">${text}</div>`);
    toasts.appendChild(t);
    while (toasts.children.length > 3) toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 4500);
    setTimeout(() => t.remove(), 5100);
  });

  let acc = 0;
  return {
    update(dt) {
      obs.update(dt);
      acc += dt;
      if (acc < 0.25) return;
      acc = 0;
      const s = terra.state;
      const day = Math.floor(s.minutes / 1440) + 1, hh = Math.floor((s.minutes / 60) % 24), mm = Math.floor(s.minutes % 60);
      top.querySelector('.day').textContent = `Gün ${day}`;
      top.querySelector('.time').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      top.querySelector('.lt').innerHTML = icon(terra.night ? 'moon' : 'sun');
      const hum = top.querySelector('[data-k="hum"]');
      hum.querySelector('i').style.width = `${s.humidity}%`;
      hum.querySelector('.pct').textContent = `%${Math.round(s.humidity)}`;
      hum.classList.toggle('warn', s.humidity < 55 || s.humidity > 95);
      top.querySelector('.temp span').textContent = `${terra.temperature.toFixed(1)}°C`;
      if (selected) {
        const n = selected;
        card.querySelector('.cname').textContent = n.data.name;
        const cm = 11 * n.data.size;
        card.querySelector('.cstate').textContent = `${n.brain.current?.label ?? 'Duruyor'} · ${cm.toFixed(1)} cm${n.data.size < n.data.adultSize - 0.01 ? ' · büyüyor' : ''}`;
        card.querySelector('[data-b="food"]').style.width = `${n.needs.energy}%`;
      }
    },
  };
}
