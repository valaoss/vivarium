import { Terrarium } from './Terrarium.js';
import { createTerraHUD } from './hud.js';

export function startTerra() {
  const terra = new Terrarium(document.getElementById('scene'));
  const hud = createTerraHUD(terra, document.getElementById('ui'));
  let last = performance.now();
  function frame(now) {
    const dt = (now - last) / 1000;
    last = now;
    terra.update(dt);
    terra.renderFrame();
    hud.update(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.terra = terra;
}
