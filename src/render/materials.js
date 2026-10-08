import * as THREE from 'three';

// Scans often ship with KHR_materials_unlit. Retain their texture and alpha
// contract while giving them an actual response to the enclosure's lighting.
export function physicalMaterial(source, options = {}) {
  const material = new THREE.MeshPhysicalMaterial();
  if (source.isMeshStandardMaterial) {
    if (source.isMeshPhysicalMaterial) material.copy(source);
    else THREE.MeshStandardMaterial.prototype.copy.call(material, source);
  } else {
    for (const key of ['map', 'alphaMap', 'aoMap', 'aoMapIntensity', 'side', 'opacity', 'transparent', 'alphaTest', 'vertexColors', 'depthWrite']) {
      if (source[key] !== undefined) material[key] = source[key];
    }
    material.color.copy(source.color);
  }
  material.name = source.name;
  material.defines = { STANDARD: '', PHYSICAL: '' };
  material.setValues(options);
  for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'alphaMap']) {
    if (material[key]) material[key].anisotropy = 8;
  }
  return material;
}

// Thin leaves scatter the light arriving from behind. This contribution tracks
// the real lamp (including nightfall); leaves never emit their own green light.
export function foliageShader(shader) {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
    .replace('#include <lights_fragment_end>', `
    #include <lights_fragment_end>
    #if NUM_DIR_LIGHTS > 0
      for (int leafLight = 0; leafLight < NUM_DIR_LIGHTS; leafLight++) {
        vec3 leafDirection = directionalLights[leafLight].direction;
        float throughLeaf = max(0.0, -dot(normal, leafDirection));
        float forwardScatter = pow(max(0.0, dot(-leafDirection, geometryViewDir)), 3.0);
        reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[leafLight].color
          * throughLeaf * (0.055 + 0.09 * forwardScatter) * getShadowMask();
      }
    #endif
  `);
}

// Fine skin relief, evaluated in rest-pose coordinates so it follows the animal.
export function skinShader(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vSkinPosition;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkinPosition = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vSkinPosition;
      float skinHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float skinNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(skinHash(i), skinHash(i + vec3(1,0,0)), f.x),
          mix(skinHash(i + vec3(0,1,0)), skinHash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(skinHash(i + vec3(0,0,1)), skinHash(i + vec3(1,0,1)), f.x),
          mix(skinHash(i + vec3(0,1,1)), skinHash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      float skinDetail = skinNoise(vSkinPosition * 32.0);
      roughnessFactor = clamp(roughnessFactor + (skinDetail - 0.5) * 0.16, 0.28, 0.72);`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec3 skinDx = dFdx(-vViewPosition), skinDy = dFdy(-vViewPosition);
      vec3 skinR1 = cross(skinDy, normal), skinR2 = cross(normal, skinDx);
      float skinDet = dot(skinDx, skinR1);
      float skinHeight = skinDetail * 0.012;
      vec3 skinGradient = sign(skinDet) * (dFdx(skinHeight) * skinR1 + dFdy(skinHeight) * skinR2);
      normal = normalize(max(abs(skinDet), 1e-8) * normal - skinGradient);
    `);
}
