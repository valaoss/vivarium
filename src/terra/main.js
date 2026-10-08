import { Terrarium } from './Terrarium.js';
import { createTerraHUD } from './hud.js';

export function startTerra() {
  const terra = new Terrarium(document.getElementById('scene'));
  const hud = createTerraHUD(terra, document.getElementById('ui'));
  let last = null;
  function frame(now) {
    const dt = last === null ? 0 : Math.max(0, (now - last) / 1000);
    last = now;
    terra.update(dt);
    terra.renderFrame();
    hud.update(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.terra = terra;
}
