import { trackFrameBudget } from './render/frameBudget.js';
import { Game } from './game/Game.js';
import { createHUD } from './ui/hud.js';
import { Sound } from './audio/Sound.js';
import { loadRealFish } from './creatures/realModels.js';
import { loadSnailShell } from './creatures/Snail.js';

let habitat = 'aqua';
try { habitat = new URLSearchParams(location.search).get('habitat') ?? localStorage.getItem('vivarium.habitat') ?? 'aqua'; } catch { /* yok */ }
if (habitat === 'terra') import('./terra/main.js').then((m) => m.startTerra());
else Promise.all([loadRealFish(), loadSnailShell()]).then(start);

function start() {
  const game = new Game(document.getElementById('scene'));
  const sound = new Sound();
  const hud = createHUD(game, document.getElementById('ui'), sound);

  // Ses ancak ilk kullanıcı etkileşiminde başlayabilir
  const unlock = () => sound.start();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  game.on('sfx', ({ name, opts }) => sound.play(name, opts));
  game.on('quest', () => sound.play('chime'));
  game.on('toast', ({ kind }) => { if (kind === 'discover') sound.play('discover'); else if (kind === 'warn') sound.play('warn'); });
  game.setMode('view');

  if (game.state.firstRun) {
    hud.showWelcome('', true);
    game.state.firstRun = false;
  } else if (game.pendingWelcome) {
    hud.showWelcome(game.pendingWelcome, false);
  }

  const trackFrame = trackFrameBudget(game);
  let last = null;
  function frame(now) {
    const dt = last === null ? 0 : Math.max(0, (now - last) / 1000);
    last = now;
    trackFrame(dt);
    game.update(dt);
    game.renderFrame();
    hud.update(dt);
    sound.update(Math.min(dt, 0.1), { camera: game.camera, airstone: game.state.airstone, lightLevel: game.lightLevel, speed: game.speed, wiping: game.wiping });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Geliştirme kolaylığı
  window.vivarium = game;
  window.vivariumSound = sound;
}
