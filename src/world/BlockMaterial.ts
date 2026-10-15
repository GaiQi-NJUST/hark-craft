import * as THREE from 'three';
import { sharedUniforms } from '../fx/Foliage';

/**
 * 方块 PBR 材质（MeshStandardMaterial + onBeforeCompile 注入）：
 * - 纹理数组采样：反照率 / 切线空间法线（导数法构建 TBN）/ 金属-粗糙-自发光-湿润
 * - 逐顶点：体素 AO（顶点色）、方块光（暖色洪泛光照）、天空光遮蔽（洞穴/室内变暗）
 * - 日出湿润高光、远处 mip 的 alpha 补偿（树叶不稀疏）、高度雾
 * - 高画质：PCSS 风格接触硬化软阴影（替换 PCF 分支）
 */

export const blockUniforms = {
  uAlb: { value: null as THREE.Texture | null },
  uNrm: { value: null as THREE.Texture | null },
  uMer: { value: null as THREE.Texture | null },
  uPBR: { value: 1 },
  uTexSize: { value: 64 },
  uNormalScale: { value: 1 },
  uBlockLightColor: { value: new THREE.Color(1.0, 0.68, 0.36) },
  uBlockK: { value: 1.6 },
  uSkyMin: { value: 0.1 },
  uWet: { value: 0 },
  uHeightFog: { value: 0.15 },
  uFogBase: { value: 20 },
  uFogColorLow: { value: new THREE.Color(0.8, 0.85, 0.9) },
};

const VERT_PARS = /* glsl */ `
attribute vec3 aTex;
attribute vec2 aLight;
varying vec3 vTex;
varying vec2 vLight;
varying vec3 vHkWorld;
`;

const FRAG_PARS = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uAlb;
uniform sampler2DArray uNrm;
uniform sampler2DArray uMer;
uniform float uPBR;
uniform float uTexSize;
uniform float uNormalScale;
uniform vec3 uBlockLightColor;
uniform float uBlockK;
uniform float uSkyMin;
uniform float uWet;
uniform float uHeightFog;
uniform float uFogBase;
uniform vec3 uFogColorLow;
varying vec3 vTex;
varying vec2 vLight;
varying vec3 vHkWorld;

vec3 hkPerturb(vec3 eye_pos, vec3 surf_norm, vec3 mapN, float faceDir) {
  vec3 q0 = dFdx(eye_pos.xyz);
  vec3 q1 = dFdy(eye_pos.xyz);
  vec2 st0 = dFdx(vTex.xy);
  vec2 st1 = dFdy(vTex.xy);
  vec3 N = surf_norm;
  vec3 q1perp = cross(q1, N);
  vec3 q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = (det == 0.0) ? 0.0 : faceDir * inversesqrt(det);
  return normalize(T * (mapN.x * scale) + B * (mapN.y * scale) + N * mapN.z);
}

float hkLod() {
  vec2 dx = dFdx(vTex.xy * uTexSize), dy = dFdy(vTex.xy * uTexSize);
  return max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
}
`;

/** PCSS：遮挡物搜索 → 半影估计 → 旋转泊松盘 PCF */
const PCSS_GLSL = /* glsl */ `
#ifdef HK_PCSS
  const vec2 hkPoisson[16] = vec2[](
    vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725), vec2(-0.09418410, -0.92938870), vec2(0.34495938, 0.29387760),
    vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464), vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
    vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420), vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
    vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590), vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790)
  );
  float hkPCSS(sampler2D sm, vec4 sc, vec2 size) {
    vec2 texel = 1.0 / size;
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float a = ign * 6.2831853;
    mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
    float bsum = 0.0, bn = 0.0;
    for (int i = 0; i < 16; i++) {
      float d = unpackRGBAToDepth(texture2D(sm, sc.xy + rot * hkPoisson[i] * texel * 7.0));
      if (d < sc.z) { bsum += d; bn += 1.0; }
    }
    if (bn < 0.5) return 1.0;
    float avg = bsum / bn;
    float pen = clamp((sc.z - avg) * 140.0, 1.0, 8.0);
    float s = 0.0;
    for (int i = 0; i < 16; i++) {
      s += texture2DCompare(sm, sc.xy + rot * hkPoisson[i] * texel * pen, sc.z);
    }
    return s / 16.0;
  }
#endif
`;

function patchShadowPars(): string {
  let chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  chunk = chunk.replace('\tfloat VSMShadow(', PCSS_GLSL + '\n\tfloat VSMShadow(');
  chunk = chunk.replace(
    '#if defined( SHADOWMAP_TYPE_PCF )',
    '#if defined( HK_PCSS )\n\t\t\tshadow = hkPCSS( shadowMap, shadowCoord, shadowMapSize );\n\t\t#elif defined( SHADOWMAP_TYPE_PCF )',
  );
  return chunk;
}

const SWAY_GLSL = /* glsl */ `
  {
    vec4 hkW0 = modelMatrix * vec4(transformed, 1.0);
    float hkPhase = uTime * 1.6 + hkW0.x * 0.55 + hkW0.z * 0.42;
    float hkGust = 0.65 + 0.35 * sin(uTime * 0.37 + hkW0.x * 0.05);
    transformed.x += sin(hkPhase) * 0.065 * aSway * uWind * hkGust;
    transformed.z += cos(hkPhase * 0.83 + 1.3) * 0.05 * aSway * uWind * hkGust;
    transformed.y += sin(hkPhase * 1.3) * 0.015 * aSway;
  }
`;

export type BlockMatKind = 'opaque' | 'cutout';

function bindUniforms(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, blockUniforms);
  shader.uniforms.uTime = sharedUniforms.uTime;
  shader.uniforms.uWind = sharedUniforms.uWind;
}

function patch(mat: THREE.MeshStandardMaterial, kind: BlockMatKind) {
  mat.onBeforeCompile = (shader) => {
    bindUniforms(shader);
    let vs = shader.vertexShader;
    vs = vs.replace(
      '#include <common>',
      '#include <common>\n' + VERT_PARS +
        (kind === 'opaque' ? 'attribute float aEmissive;\nvarying float vEmissive;\n' : 'attribute float aSway;\nuniform float uTime;\nuniform float uWind;\n'),
    );
    vs = vs.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n' +
        (kind === 'opaque' ? 'vEmissive = aEmissive;\n' : SWAY_GLSL) +
        'vTex = aTex;\nvLight = aLight;\nvHkWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n',
    );
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', '#include <common>\n' + FRAG_PARS + (kind === 'opaque' ? 'varying float vEmissive;\n' : ''));
    fs = fs.replace('#include <shadowmap_pars_fragment>', patchShadowPars());
    fs = fs.replace(
      '#include <map_fragment>',
      /* glsl */ `
      vec4 hkAlb = texture(uAlb, vTex);
      vec4 hkNrm = texture(uNrm, vTex);
      vec4 hkMer = texture(uMer, vTex);
      ${kind === 'cutout' ? 'hkAlb.a *= 1.0 + hkLod() * 0.35;' : ''}
      diffuseColor *= hkAlb;
      diffuseColor.rgb *= mix(1.0, hkNrm.a, uPBR);
      `,
    );
    fs = fs.replace(
      '#include <roughnessmap_fragment>',
      /* glsl */ `
      float roughnessFactor = mix(roughness, hkMer.g, uPBR);
      // 日出/雨后湿润：多孔材质（石、砖、木）粗糙度下降 → 镜面高光
      roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.38, uWet * hkMer.a * uPBR);
      roughnessFactor = max(roughnessFactor, 0.06);
      `,
    );
    fs = fs.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(metalness, hkMer.r, uPBR);');
    if (kind === 'cutout') {
      // 双面植物/树叶：背面不翻转法线，避免背光面发黑
      fs = fs.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\nnormal *= faceDirection;\n#endif',
      );
    }
    fs = fs.replace(
      '#include <normal_fragment_maps>',
      /* glsl */ `
      {
        vec3 hkN = hkNrm.xyz * 2.0 - 1.0;
        hkN.xy *= uNormalScale * uPBR;
        normal = hkPerturb(-vViewPosition, normal, normalize(hkN), faceDirection);
      }
      `,
    );
    fs = fs.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n' +
        (kind === 'opaque' ? 'totalEmissiveRadiance += diffuseColor.rgb * vEmissive * mix(0.8, 0.25 + hkMer.b * 0.85, uPBR);\n' : '') +
        (kind === 'opaque' ? 'float hkSelf = vEmissive > 0.5 ? 0.2 : 1.0;\n' : 'float hkSelf = 1.0;\n') +
        'totalEmissiveRadiance += diffuseColor.rgb * uBlockLightColor * (pow(vLight.x, 2.6) * uBlockK * hkSelf);\n',
    );
    fs = fs.replace(
      '#include <lights_fragment_end>',
      /* glsl */ `#include <lights_fragment_end>
      {
        float hkSky = mix(uSkyMin, 1.0, vLight.y);
        reflectedLight.indirectDiffuse *= hkSky;
        reflectedLight.indirectSpecular *= hkSky * hkSky;
      }
      `,
    );
    fs = fs.replace(
      '#include <fog_fragment>',
      /* glsl */ `
      #ifdef USE_FOG
        float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
        // 高度雾：低处（海平面附近）更浓，随距离累积
        float hkH = exp(-max(vHkWorld.y - uFogBase, 0.0) * 0.12) * uHeightFog * (1.0 - exp(-vFogDepth * 0.02));
        vec3 hkFogCol = mix(fogColor, uFogColorLow, clamp(hkH * 1.5, 0.0, 1.0));
        fogFactor = clamp(max(fogFactor, hkH), 0.0, 1.0);
        gl_FragColor.rgb = mix( gl_FragColor.rgb, hkFogCol, fogFactor );
      #endif
      `,
    );
    shader.fragmentShader = fs;
  };
}

export function createBlockMaterial(kind: BlockMatKind, pcss: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: kind === 'opaque' ? 0.9 : 0.8,
    metalness: 0,
    ...(kind === 'cutout' ? { alphaTest: 0.5, side: THREE.DoubleSide } : {}),
  });
  setPCSS(mat, pcss);
  patch(mat, kind);
  return mat;
}

export function setPCSS(mat: THREE.MeshStandardMaterial, on: boolean) {
  const m = mat as THREE.MeshStandardMaterial & { defines: Record<string, string> };
  m.defines = m.defines || {};
  const had = 'HK_PCSS' in m.defines;
  if (on) m.defines.HK_PCSS = '';
  else delete m.defines.HK_PCSS;
  const kind = mat.alphaTest > 0 ? 'cutout' : 'opaque';
  mat.customProgramCacheKey = () => `hark-block-${kind}-${on ? 'pcss' : 'pcf'}`;
  if (had !== on) mat.needsUpdate = true;
}

/** 阴影深度材质：纹理数组 alpha + 随风摆动（树叶阴影随风晃动） */
export function createCutoutDepthMaterial(): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({
    alphaTest: 0.5,
    depthPacking: THREE.RGBADepthPacking,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    bindUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aTex;\nattribute float aSway;\nuniform float uTime;\nuniform float uWind;\nvarying vec3 vTex;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWAY_GLSL + 'vTex = aTex;\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uAlb;\nvarying vec3 vTex;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= texture(uAlb, vTex).a;');
  };
  mat.customProgramCacheKey = () => 'hark-cutout-depth-arr';
  return mat;
}
