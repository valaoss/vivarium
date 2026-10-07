import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.55 },
    uCA: { value: 0.00035 },
    uGrain: { value: 0.025 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uCA, uGrain;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * uCA * 40.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + off).b;
      float vig = smoothstep(0.95, 0.2, r2 * 2.2 * uVignette + 0.1);
      col *= mix(1.0, vig, uVignette);
      col += (h(vUv * 1000.0 + fract(uTime)) - 0.5) * uGrain * (0.3 + dot(col, vec3(0.33)));
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export function createPostFX(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bokeh = new BokehPass(scene, camera, { focus: 100, aperture: 0.0006, maxblur: 0.007 });
  bokeh.enabled = false;
  // Derinlik geçişinde cam, su hacmi ve partiküller gibi saydam nesneler
  // odak mesafesini bozmasın: bu geçiş boyunca gizlenir.
  const bokehRender = bokeh.render.bind(bokeh);
  bokeh.render = (...args) => {
    const hidden = [];
    scene.traverse((o) => {
      const m = o.material;
      if (o.visible && m && (m.transparent || m.depthWrite === false)) { o.visible = false; hidden.push(o); }
    });
    bokehRender(...args);
    for (const o of hidden) o.visible = true;
  };
  composer.addPass(bokeh);

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.6, 0.88);
  composer.addPass(bloom);

  const final = new ShaderPass(FinalShader);
  composer.addPass(final);
  composer.addPass(new OutputPass());
  const smaa = new SMAAPass();
  composer.addPass(smaa);

  return {
    composer,
    bokeh,
    bloom,
    final,
    setSize(w, h) { composer.setSize(w, h); },
    render(t) {
      final.uniforms.uTime.value = t;
      composer.render();
    },
  };
}
