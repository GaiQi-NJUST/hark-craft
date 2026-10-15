import * as THREE from 'three';
import { sharedUniforms } from './Foliage';

/**
 * 半透明动态水面：顶点波浪 + 解析法线 + 菲涅尔天空反射 + 太阳高光闪烁。
 * 天空/太阳颜色由 SkySystem 每帧同步。
 */

const WAVE = /* glsl */ `
float hkWave(vec2 p, float t) {
  return sin(p.x * 0.8 + t * 1.4) * 0.04
       + cos(p.y * 0.7 + t * 1.1) * 0.04
       + sin((p.x + p.y) * 1.7 + t * 2.3) * 0.015
       + sin(p.x * 3.1 - t * 2.0 + p.y * 2.3) * 0.008;
}
`;

export function createWaterMaterial() {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
      uSunVis: { value: 1 },
      uSky: { value: new THREE.Color(0.35, 0.55, 0.85) },
      uHorizon: { value: new THREE.Color(0.8, 0.75, 0.7) },
      uShallow: { value: new THREE.Color(0.12, 0.42, 0.55) },
      uDeep: { value: new THREE.Color(0.02, 0.12, 0.28) },
      uDaylight: { value: 1 },
    },
  ]);
  uniforms.uTime = sharedUniforms.uTime;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aSurface;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      ${WAVE}
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        wp.y += (hkWave(wp.xz, uTime) - 0.04) * aSurface;
        vWorld = wp.xyz;
        vNormalW = normal;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunVis;
      uniform vec3 uSky;
      uniform vec3 uHorizon;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform float uDaylight;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      ${WAVE}
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec3 N = normalize(vNormalW);
        if (vNormalW.y > 0.5) {
          float e = 0.06;
          float hx = hkWave(vWorld.xz + vec2(e, 0.0), uTime) - hkWave(vWorld.xz - vec2(e, 0.0), uTime);
          float hz = hkWave(vWorld.xz + vec2(0.0, e), uTime) - hkWave(vWorld.xz - vec2(0.0, e), uTime);
          N = normalize(vec3(-hx / (2.0 * e) * 1.8, 1.0, -hz / (2.0 * e) * 1.8));
        }
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(N, V) < 0.0) N = -N; // 水下仰视
        float ndv = max(dot(N, V), 0.0);
        float fres = 0.06 + 0.94 * pow(1.0 - ndv, 5.0);
        vec3 R = reflect(-V, N);
        vec3 sky = mix(uHorizon, uSky, smoothstep(0.0, 0.6, R.y));
        float depthTint = 0.5 + 0.5 * sin(vWorld.x * 0.13 + vWorld.z * 0.11);
        vec3 body = mix(uShallow, uDeep, 0.55 + 0.25 * depthTint) * (0.25 + 0.75 * uDaylight);
        vec3 col = mix(body, sky, clamp(fres * 1.2, 0.0, 1.0));
        float sd = max(dot(R, normalize(uSunDir)), 0.0);
        float glint = pow(sd, 380.0) * 14.0 + pow(sd, 48.0) * 0.6;
        // 粼粼闪光：高频噪声调制
        float sparkle = step(0.86, fract(sin(dot(floor(vWorld.xz * 6.0 + uTime * 0.6), vec2(12.9898, 78.233))) * 43758.5453));
        glint *= 0.6 + sparkle * 1.6;
        col += uSunColor * glint * uSunVis;
        float alpha = clamp(mix(0.58, 0.95, fres) + glint * 0.2, 0.0, 1.0);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  return mat;
}

export type WaterMaterial = ReturnType<typeof createWaterMaterial>;
