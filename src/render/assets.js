import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// Poly Haven (CC0) dokuları: public/textures altında, 1k çözünürlük.
const loader = new THREE.TextureLoader();
const BASE = `${import.meta.env.BASE_URL}textures/`;

/** { map, normalMap, roughnessMap } döndürür; dokular arka planda yüklenir. */
export function pbrSet(name, repeat = [1, 1]) {
  const load = (suffix, srgb) => {
    const t = loader.load(`${BASE}${name}_${suffix}_1k.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: load('diff', true), normalMap: load('nor_gl', false), roughnessMap: load('rough', false) };
}

export function loadEnvironment(renderer, scene, name = 'hotel_room') {
  const pmrem = new THREE.PMREMGenerator(renderer);
  new HDRLoader().load(`${BASE}${name}_1k.hdr`, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const env = pmrem.fromEquirectangular(hdr).texture;
    scene.environment?.dispose?.();
    scene.environment = env;
    hdr.dispose();
    pmrem.dispose();
  });
}

/**
 * UV'si olmayan prosedürel geometriler (taş, çakıl) için üç eksenli (triplanar)
 * doku: renk, normal ve pürüzlülük nesne uzayından yansıtılır.
 * `scale`: cm başına doku tekrarı.
 */
export function triplanarHook(set, scale = 0.12) {
  return (shader) => {
    shader.uniforms.tpMap = { value: set.map };
    shader.uniforms.tpNormal = { value: set.normalMap };
    shader.uniforms.tpRough = { value: set.roughnessMap };
    shader.uniforms.tpScale = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 tp = vec4(position, 1.0);
          vec3 tn = normal;
          #ifdef USE_INSTANCING
            tp = instanceMatrix * tp;
            tn = mat3(instanceMatrix) * tn;
          #endif
          vTpPos = (modelMatrix * tp).xyz;
          vTpN = normalize(mat3(modelMatrix) * tn);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tpMap, tpNormal, tpRough;
        uniform float tpScale;
        varying vec3 vTpPos;
        varying vec3 vTpN;
        vec3 tpWeights(vec3 n) { vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }`)
      .replace('#include <map_fragment>', `
        vec3 tpW = tpWeights(vTpN);
        vec3 tpP = vTpPos * tpScale;
        vec4 tpC = texture2D(tpMap, tpP.zy) * tpW.x + texture2D(tpMap, tpP.xz) * tpW.y + texture2D(tpMap, tpP.xy) * tpW.z;
        diffuseColor *= tpC;`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;
        roughnessFactor *= (texture2D(tpRough, tpP.zy).g * tpW.x + texture2D(tpRough, tpP.xz).g * tpW.y + texture2D(tpRough, tpP.xy).g * tpW.z);`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 N0 = normalize(vTpN);
          vec3 tX = texture2D(tpNormal, tpP.zy).xyz * 2.0 - 1.0;
          vec3 tY = texture2D(tpNormal, tpP.xz).xyz * 2.0 - 1.0;
          vec3 tZ = texture2D(tpNormal, tpP.xy).xyz * 2.0 - 1.0;
          // UDN karışımı
          vec3 nX = vec3(N0.x, tX.y + N0.y, tX.x + N0.z);
          vec3 nY = vec3(tY.x + N0.x, N0.y, tY.y + N0.z);
          vec3 nZ = vec3(tZ.x + N0.x, tZ.y + N0.y, N0.z);
          vec3 wn = normalize(nX * tpW.x + nY * tpW.y + nZ * tpW.z);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz) * faceDirection;
        }`);
  };
}
