import * as THREE from 'three';

/**
 * 方块材质：
 * - 不透明材质：顶点色承载烘焙 AO，aEmissive 属性驱动荧石等自发光（HDR → 辉光）。
 * - 镂空材质：树叶/草/花，通过 onBeforeCompile 注入风吹摆动（基于世界坐标，相邻方块同相位不会裂缝）。
 */

export const sharedUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
};

export function createOpaqueMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map,
    vertexColors: true,
    roughness: 0.93,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEmissive;\nvarying float vEmissive;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmissive = aEmissive;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEmissive;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vEmissive;',
      );
  };
  mat.customProgramCacheKey = () => 'hark-opaque';
  return mat;
}

const SWAY_GLSL = /* glsl */ `
  vec4 hkWorld = modelMatrix * vec4(transformed, 1.0);
  float hkPhase = uTime * 1.6 + hkWorld.x * 0.55 + hkWorld.z * 0.42;
  float hkGust = 0.65 + 0.35 * sin(uTime * 0.37 + hkWorld.x * 0.05);
  transformed.x += sin(hkPhase) * 0.065 * aSway * uWind * hkGust;
  transformed.z += cos(hkPhase * 0.83 + 1.3) * 0.05 * aSway * uWind * hkGust;
  transformed.y += sin(hkPhase * 1.3) * 0.015 * aSway;
`;

function injectSway(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.uniforms.uTime = sharedUniforms.uTime;
  shader.uniforms.uWind = sharedUniforms.uWind;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uTime;\nuniform float uWind;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWAY_GLSL);
}

export function createCutoutMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map,
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    injectSway(shader);
    // 双面植物/树叶：背面不翻转法线，避免背光面发黑（植物法线统一朝上，接受天光）
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\nnormal *= faceDirection;\n#endif',
    );
  };
  mat.customProgramCacheKey = () => 'hark-cutout';
  return mat;
}

/** 阴影深度材质：同样带摆动与 alpha 测试，让树叶阴影随风晃动 */
export function createCutoutDepthMaterial(map: THREE.Texture): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({
    map,
    alphaTest: 0.5,
    depthPacking: THREE.RGBADepthPacking,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = injectSway;
  mat.customProgramCacheKey = () => 'hark-cutout-depth';
  return mat;
}
