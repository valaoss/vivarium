import * as THREE from 'three';
import { icon, h } from '../ui/hud.js';

// Geliştirici gözlem sistemi: seçili canlının ihtiyaçları, algıları, karar puanları ve gerekçeleri,
// hedefi, hafızası; sahnede algı çizgileri, görüş/titreşim menzili, hedef ve ayak temasları.
// Ayrıca test senaryoları: hız, sıcaklık, nem, cırcır / erkek örümcek ekleme, tehdit.

const SENSE_COL = { 'koku': 0xff9de6, 'görme': 0x7fd0ff, 'titreşim:water': 0x4fffd0, 'titreşim:ground': 0xffc35a, 'hava akımı (cerci)': 0xd59bff, 'temas': 0xffffff };
const ROLE_COL = { 'av': '#7fe08a', 'av?': '#b9e07f', 'tehdit': '#ff7a6a', 'eş': '#ff9de6', 'rakip': '#ffb36a', 'önemsiz': '#9aa4ad' };

export function createObserver(terra, root) {
  const panel = h(`<div class="obs glass hidden">
    <div class="obs-head"><b>Gözlem</b><span class="obs-sub">bir canlıya dokun</span>
      <button class="obs-x">${icon('close')}</button></div>
    <div class="obs-ctl">
      <span>Hız</span><button data-sp="1">1×</button><button data-sp="5">5×</button><button data-sp="20">20×</button><button data-sp="60">60×</button>
      <button data-act="follow" title="Kamera takip">${icon('follow')}</button>
    </div>
    <div class="obs-ctl">
      <span>Ortam</span><button data-act="cold">−2°C</button><button data-act="warm">+2°C</button><button data-act="dry">Kurut</button><button data-act="night">Gece/Gündüz</button>
    </div>
    <div class="obs-ctl">
      <span>Senaryo</span><button data-act="worm">+Solucan</button><button data-act="threat">Tehdit</button><button data-act="starve">Aç bırak</button><button data-act="air">O₂ bitir</button>
    </div>
    <div class="obs-body"></div>
  </div>`);
  root.appendChild(panel);
  const body = panel.querySelector('.obs-body');

  const g = new THREE.Group();
  g.renderOrder = 10;
  terra.scene.add(g);
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false });
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
  lines.frustumCulled = false;
  lines.renderOrder = 10;
  g.add(lines);
  const ringGeo = new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2);
  const visRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.35, depthTest: false }));
  const vibRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x4fffd0, transparent: true, opacity: 0.3, depthTest: false }));
  g.add(visRing, vibRing);
  const dotGeo = new THREE.SphereGeometry(0.12, 8, 6);
  const feetI = new THREE.InstancedMesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }), 8);
  feetI.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24), 3);
  feetI.frustumCulled = false;
  g.add(feetI);
  const tgt = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 6, 24).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe066, depthTest: false }));
  g.add(tgt);
  g.visible = false;

  let on = false, sel = null, follow = false, acc = 0;
  const camOff = new THREE.Vector3();
  const set = (v) => { on = v; panel.classList.toggle('hidden', !on); g.visible = on && !!sel; terra.observing = on; };
  panel.querySelector('.obs-x').onclick = () => set(false);
  panel.querySelectorAll('[data-sp]').forEach((b) => b.onclick = () => {
    terra.speedMul = +b.dataset.sp;
    panel.querySelectorAll('[data-sp]').forEach((x) => x.classList.toggle('on', x === b));
  });
  panel.querySelector('[data-sp="1"]').classList.add('on');
  const act = {
    follow: (b) => { follow = !follow; b.classList.toggle('on', follow); if (follow && sel) camOff.subVectors(terra.camera.position, sel.pos).setLength(Math.min(28, terra.camera.position.distanceTo(sel.pos))); },
    cold: () => { terra.heatOffset = (terra.heatOffset ?? 0) - 2; terra.temp -= 2; },
    warm: () => { terra.heatOffset = (terra.heatOffset ?? 0) + 2; terra.temp += 2; },
    dry: () => { terra.state.humidity = Math.max(30, terra.state.humidity - 25); },
    night: () => { terra.state.minutes += 12 * 60; },
    worm: () => { const a = Math.random() * 6.28, r = 6 + Math.random() * 8, p = sel?.pos ?? new THREE.Vector3(); terra.dropWorm(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r); },
    air: () => { if (sel?.needs?.oxygen !== undefined) sel.needs.oxygen = 8; },
    threat: () => terra.pokeThreat?.(sel?.pos),
    starve: () => { if (sel?.needs) sel.needs.energy = 8; },
  };
  panel.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => act[b.dataset.act](b));

  const bar = (label, v, warn) => `<div class="obs-bar ${warn ? 'warn' : ''}"><span>${label}</span><i style="--v:${Math.max(0, Math.min(100, v))}%"></i><em>${Math.round(v)}</em></div>`;
  const esc = (t) => String(t ?? '').replace(/</g, '&lt;');

  function render() {
    if (!sel) { body.innerHTML = '<div class="obs-empty">Sahnede bir canlıya dokun. Kararlarını, algıladıklarını ve nedenlerini burada izleyebilirsin.</div>'; return; }
    if (!sel.inspect) { body.innerHTML = `<div class="obs-empty">${esc(sel.label ?? sel.kind)}: bu canlı henüz yeni yapay zekâya taşınmadı.</div>`; return; }
    const I = sel.inspect();
    const n = sel.needs ?? {};
    const d = sel.data ?? {};
    let head = `<div class="obs-name">${esc(d.name ?? sel.label)} <small>${esc(sel.label)}</small></div>`;
    if (I.meta) head += I.meta.map((m) => `<div class="obs-meta">${esc(m)}</div>`).join('');
    if (sel.kind === 'spider') {
      head += `<div class="obs-meta">${d.sex === 'F' ? 'Dişi' : 'Erkek'} · ${sel.adult ? 'yetişkin' : `${d.instar}. evre`} · ${sel.bodyLen.toFixed(2)} cm gövde · yaş ${d.age.toFixed(0)} biyo-gün${!sel.adult ? ` · deri değişimi %${Math.round(Math.min(1, d.moltProg) * 100)}` : ''}${d.mated ? ' · çiftleşti' : ''}</div>`;
      head += `<div class="obs-meta">Av: ${d.kills} başarılı / ${d.misses} kaçan · sıcaklık etkisi ×${sel.q.toFixed(2)} · sudaki bacak %${Math.round(sel.body.contactWater * 100)}${sel.state === 'dead' ? ` · ÖLÜ (${d.cause})` : ''}</div>`;
      const t = sel.traits;
      head += `<div class="obs-meta">Kişilik: cesaret ${(t.boldness * 100) | 0} · etkinlik ${(t.activity * 100) | 0} · sabır ${(t.patience * 100) | 0} · tepki ${(t.reactivity * 100) | 0}</div>`;
    } else if (I.extra) head += `<div class="obs-meta">${esc(I.extra)}</div>`;
    const needs = (I.bars ?? [['Tokluk', n.energy ?? 0, n.energy < 25], ['Su', n.water ?? 0, n.water < 30], ['Yorgunluk', n.fatigue ?? 0], ['Stres', n.stress ?? 0, n.stress > 60], ['Sağlık', n.health ?? 0, n.health < 50]]).map((b) => bar(...b)).join('');
    const scores = I.scores.map((s, i) => `<div class="obs-score ${i === 0 ? 'top' : ''}"><b>${s.v.toFixed(2)}</b><span>${esc(s.label)}</span><em>${esc(s.why)}</em></div>`).join('');
    const per = I.percepts.map((p) => `<div class="obs-per"><i style="background:${ROLE_COL[p.role] ?? '#9aa4ad'}"></i><b>${esc(p.e ? (p.e.data?.name ?? p.e.label ?? p.e.kind) : 'bilinmeyen kaynak')}</b> <span>${[...p.senses].join(', ') || 'iz (hafıza)'} · ${p.dist?.toFixed(1) ?? '?'} cm · güven ${(p.conf * 100) | 0}%</span><em>${esc(p.role ?? '')}${p.why ? ': ' + esc(p.why) : ''}</em></div>`).join('') || '<div class="obs-dim">Şu an hiçbir şey algılamıyor.</div>';
    const mem = I.memory.map((m) => `<span class="obs-chip">${esc(m.kind)} ${m.value.toFixed(1)}</span>`).join(' ');
    const hist = I.history.map((x) => `<div class="obs-h">${x.end ? '✓' : '→'} ${esc(x.id)} <em>${esc(x.why)}</em></div>`).join('');
    body.innerHTML = `${head}
      <div class="obs-now"><b>${esc(I.action)}</b><div>${esc(I.reason)}</div><div class="obs-next">${esc(I.note)}</div></div>
      <div class="obs-sec">İhtiyaçlar</div>${needs}
      <div class="obs-sec">Karar puanları</div>${scores}
      <div class="obs-sec">Algıladıkları</div>${per}
      <div class="obs-sec">Hafıza</div><div>${mem || '<span class="obs-dim">boş</span>'}</div>
      <div class="obs-sec">Son kararlar</div>${hist}`;
  }

  const _v = new THREE.Vector3();
  function gizmos() {
    if (!sel || !sel.alive || !sel.percepts) { g.visible = false; return; }
    g.visible = on;
    const pts = [], cols = [];
    const c = new THREE.Color();
    const from = sel.body ? sel.body.bodyCenter(new THREE.Vector3()) : sel.headPos ? sel.headPos(new THREE.Vector3()) : sel.pos.clone().add(new THREE.Vector3(0, 0.5, 0));
    for (const p of sel.percepts.values()) {
      const s = [...p.senses][0] ?? 'temas';
      c.setHex(SENSE_COL[s] ?? 0xcccccc).multiplyScalar(0.4 + p.conf * 0.6);
      pts.push(from.x, from.y, from.z, p.pos.x, p.pos.y + 0.3, p.pos.z);
      cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    if (sel.target?.pos) { c.setHex(0xffe066); pts.push(from.x, from.y, from.z, sel.target.pos.x, sel.target.pos.y + 0.3, sel.target.pos.z); cols.push(c.r, c.g, c.b, c.r, c.g, c.b); }
    // son titreşim olayları: kısa dikey işaretler
    for (const v of terra.eco.vib) {
      if (terra.eco.time - v.t > 0.6) continue;
      c.setHex(v.medium === 'water' ? 0x4fffd0 : 0xffc35a).multiplyScalar(Math.min(1, v.amp * 2));
      pts.push(v.pos.x, v.pos.y, v.pos.z, v.pos.x, v.pos.y + 0.4 + v.amp, v.pos.z);
      cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const geo = lines.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const base = sel.pos;
    const vr = sel.kind === 'spider' ? 22 * (0.6 + 0.4 * sel.sizeScale) * THREE.MathUtils.lerp(0.22, 1, terra.lightLevel ?? 1) * 0.5 : sel.kind === 'newt' ? (sel.inWater ? 12 : 18) * THREE.MathUtils.lerp(0.45, 1, terra.lightLevel ?? 1) * 0.5 : 7;
    visRing.position.set(base.x, base.y + 0.15, base.z); visRing.scale.setScalar(vr);
    vibRing.position.copy(visRing.position); vibRing.scale.setScalar(sel.kind === 'spider' ? (sel.body.contactWater > 0.1 ? 11 : 2.6) * 1.5 : sel.kind === 'newt' ? (sel.inWater ? 7.5 : 0.01) : 3);
    if (sel.body) {
      sel.body.feet.forEach((f, i) => {
        feetI.setMatrixAt(i, new THREE.Matrix4().makeTranslation(f.pos.x, f.pos.y, f.pos.z));
        feetI.setColorAt(i, c.setHex(f.held > 0 ? 0xff7a6a : f.planted ? 0x7fe08a : 0xffe066));
      });
      feetI.count = 8; feetI.instanceMatrix.needsUpdate = true; feetI.instanceColor.needsUpdate = true;
    } else feetI.count = 0;
    feetI.visible = !!sel.body;
    tgt.visible = !!sel.target?.pos;
    if (tgt.visible) tgt.position.copy(sel.target.pos).add(_v.set(0, 0.2, 0));
  }

  terra.on('select', (c) => { if (c) sel = c; panel.querySelector('.obs-sub').textContent = sel ? (sel.data?.name ?? sel.label) : 'bir canlıya dokun'; render(); });

  return {
    toggle() { set(!on); render(); },
    get on() { return on; },
    update(dt) {
      if (follow && sel) {
        const t = terra.controls.target;
        _v.copy(sel.pos);
        const k = Math.min(1, dt * 3);
        const dlt = _v.sub(t).multiplyScalar(k);
        t.add(dlt); terra.camera.position.add(dlt);
      }
      if (!on) return;
      gizmos();
      acc += dt;
      if (acc > 0.3) { acc = 0; render(); }
    },
    select(c) { sel = c; render(); },
  };
}
