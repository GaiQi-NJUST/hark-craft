import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { QualitySettings } from './Quality';

/**
 * 后处理链（线性 HDR → 色调映射 → 显示空间调色）：
 * RenderPass → GTAO(SSAO，仅高画质) → UnrealBloom → 径向体积光(God Rays) → OutputPass(ACES+sRGB) → 调色/暗角/胶片颗粒
 */

const GodRayShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uLight: { value: new THREE.Vector2(0.5, 0.5) },
    uIntensity: { value: 0 },
    uColor: { value: new THREE.Color(1, 0.85, 0.6) },
    uThreshold: { value: 0.9 },
    uDensity: { value: 0.9 },
    uDecay: { value: 0.965 },
    uAspect: { value: 1 },
  },
  defines: { SAMPLES: 60 },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uLight;
    uniform float uIntensity;
    uniform vec3 uColor;
    uniform float uThreshold;
    uniform float uDensity;
    uniform float uDecay;
    uniform float uAspect;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uIntensity <= 0.001) { gl_FragColor = base; return; }
      vec2 delta = (vUv - uLight) * uDensity / float(SAMPLES);
      vec2 uv = vUv;
      float illum = 1.0;
      vec3 acc = vec3(0.0);
      // 抖动减少条纹
      float jitter = fract(sin(dot(vUv * 1000.0, vec2(12.9898, 78.233))) * 43758.5453);
      uv -= delta * jitter;
      for (int i = 0; i < SAMPLES; i++) {
        uv -= delta;
        vec3 s = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
        vec2 d = (uv - uLight) * vec2(uAspect, 1.0);
        float near = 1.0 - smoothstep(0.0, 0.55, length(d));
        acc += s * smoothstep(uThreshold, uThreshold * 2.5, l) * illum * near;
        illum *= uDecay;
      }
      acc /= float(SAMPLES);
      gl_FragColor = vec4(base.rgb + acc * uColor * uIntensity, base.a);
    }
  `,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.38 },
    uGrain: { value: 0.035 },
    uWarm: { value: 1 },
    uFade: { value: 0 },
    uFadeColor: { value: new THREE.Color(0, 0, 0) },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uWarm;
    uniform float uFade;
    uniform vec3 uFadeColor;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // 分离调色：阴影偏青、高光偏暖
      vec3 shadowTint = vec3(0.90, 1.0, 1.07);
      vec3 highTint = vec3(1.07, 1.0, 0.90);
      c *= mix(shadowTint, vec3(1.0), smoothstep(0.0, 0.45, l)) ;
      c = mix(c, c * highTint, smoothstep(0.35, 1.0, l) * 0.8 * uWarm);
      // 轻微 S 曲线 + 饱和度
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);
      float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(g), c, 1.1);
      // 暗角
      vec2 d = vUv - 0.5;
      d.x *= uResolution.x / uResolution.y;
      float vig = smoothstep(0.95, 0.25, length(d));
      c *= mix(1.0, vig, uVignette);
      // 胶片颗粒
      float n = hash(vUv * uResolution + fract(uTime * 13.37) * 100.0) - 0.5;
      c += n * uGrain * (1.0 - g * 0.5);
      c = mix(c, uFadeColor, uFade);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export class PostFX {
  readonly composer: EffectComposer;
  readonly renderPass: RenderPass;
  readonly gtao: GTAOPass;
  readonly bloom: UnrealBloomPass;
  readonly godRays: ShaderPass;
  readonly output: OutputPass;
  readonly grade: ShaderPass;
  private renderer: THREE.WebGLRenderer;
  private ssaoWanted = false;
  private raysWanted = true;
  private samples = 60;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, msaa = true) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    // 多重采样渲染目标（桌面端），弥补后处理链丢失的硬件抗锯齿
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x * pr), Math.max(1, size.y * pr), {
      type: THREE.HalfFloatType,
      samples: msaa ? 4 : 0,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.5, thickness: 1.5, scale: 1.1, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.gtao.enabled = false;
    this.composer.addPass(this.gtao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.6, 0.92);
    this.composer.addPass(this.bloom);

    this.godRays = new ShaderPass(GodRayShader);
    this.composer.addPass(this.godRays);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  setScene(scene: THREE.Scene, camera: THREE.Camera, allowSSAO: boolean) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.gtao.scene = scene;
    this.gtao.camera = camera;
    this.gtao.enabled = this.ssaoWanted && allowSSAO;
  }

  applyQuality(q: QualitySettings, allowSSAO: boolean) {
    this.ssaoWanted = q.ssao;
    this.gtao.enabled = q.ssao && allowSSAO;
    this.raysWanted = q.godRays;
    this.bloom.enabled = q.bloom;
    if (this.samples !== q.godRaySamples) {
      this.samples = q.godRaySamples;
      const m = this.godRays.material as THREE.ShaderMaterial;
      m.defines.SAMPLES = q.godRaySamples;
      m.needsUpdate = true;
    }
  }

  /** 设置体积光光源（屏幕 uv）及强度 */
  setLight(screen: THREE.Vector2, intensity: number, color?: THREE.Color) {
    const u = this.godRays.uniforms;
    u.uLight.value.copy(screen);
    u.uIntensity.value = this.raysWanted ? intensity : 0;
    if (color) u.uColor.value.copy(color);
    this.godRays.enabled = this.raysWanted && intensity > 0.001;
  }

  setRayThreshold(t: number) {
    this.godRays.uniforms.uThreshold.value = t;
  }

  setBloom(strength: number, radius: number, threshold: number) {
    this.bloom.strength = strength;
    this.bloom.radius = radius;
    this.bloom.threshold = threshold;
  }

  setFade(amount: number, color?: THREE.Color) {
    this.grade.uniforms.uFade.value = amount;
    if (color) this.grade.uniforms.uFadeColor.value.copy(color);
  }

  setSize(w: number, h: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.grade.uniforms.uResolution.value.set(w * pr, h * pr);
    this.godRays.uniforms.uAspect.value = w / h;
  }

  render(dt: number, time: number) {
    this.grade.uniforms.uTime.value = time;
    this.composer.render(dt);
  }
}
