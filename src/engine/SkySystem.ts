import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { Lighting } from './Lighting';
import type { WaterMaterial } from '../fx/Water';
import { blockUniforms } from '../world/BlockMaterial';
import { sharedUniforms } from '../fx/Foliage';

const CLOUD_VS = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const CLOUD_FS = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyCol;
  uniform vec3 uHorizon;
  uniform float uDay;
  uniform float uNight;
  uniform float uGolden;
  uniform float uCover;
  uniform vec3 uCam;
  varying vec3 vW;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < CLOUD_OCT; i++) { s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return s;
  }
  void main() {
    vec2 p = vW.xz * 0.0055 + vec2(uTime * 0.0045, uTime * 0.0018);
    float n = fbm(p);
    float d = smoothstep(uCover, uCover + 0.22, n);
    if (d < 0.003) discard;
    float dist = length(vW.xz - uCam.xz);
    float fade = 1.0 - smoothstep(420.0, 1250.0, dist);
    // 朝太阳方向偏移采样 → 云体自阴影
    float n2 = fbm(p + normalize(uSunDir.xz + 1e-4) * 0.05);
    float shade = clamp(1.0 - (n2 - n) * 4.0, 0.35, 1.25);
    vec3 V = normalize(vW - uCam);
    float silver = pow(max(dot(V, uSunDir), 0.0), 8.0) * (1.0 - d) * 2.0;
    vec3 base = mix(uSkyCol * 0.9 + vec3(0.18), vec3(1.0), 0.55);
    vec3 lit = (base * shade + uSunColor * (0.35 * shade + silver)) * (0.15 + 0.85 * uDay);
    lit = mix(lit, lit * vec3(1.15, 0.82, 0.62) + uSunColor * 0.25, uGolden * 0.6);
    lit = mix(lit, vec3(0.05, 0.06, 0.1), uNight * 0.85);
    lit = mix(uHorizon, lit, fade);
    gl_FragColor = vec4(lit, d * fade * 0.92);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const ENV_VS = /* glsl */ `
  varying vec3 vDir;
  void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const ENV_FS = /* glsl */ `
  uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunVis;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    vec3 c = d.y > 0.0 ? mix(uHorizon, uZenith, pow(d.y, 0.55)) : mix(uHorizon, uGround, clamp(-d.y * 4.0, 0.0, 1.0));
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    c += uSunColor * (pow(s, 600.0) * 40.0 + pow(s, 12.0) * 0.6) * uSunVis;
    gl_FragColor = vec4(c, 1.0);
  }
`;

/**
 * 昼夜循环（约 6 分钟一天，从日出开始）：three Sky 大气散射 + 星空 + 像素月亮，
 * 同步太阳/月光方向与颜色、半球光、雾颜色、水面反射、曝光。
 */

export const DAY_LENGTH_SEC = 360;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const C = (hex: number) => new THREE.Color(hex);

const PALETTE = {
  fogDay: C(0xa9c6e6),
  fogGold: C(0xf0a874),
  fogNight: C(0x0b1022),
  zenithDay: C(0x4a7fd0),
  zenithGold: C(0x7a7fb8),
  zenithNight: C(0x060a18),
  hemiDay: C(0xcfe2ff),
  hemiGold: C(0xffc49a),
  hemiNight: C(0x2a3a6a),
  groundDay: C(0x6b5a3f),
  groundNight: C(0x0b0b14),
  sunNoon: C(0xfff3e0),
  sunGold: C(0xff9142),
  moon: C(0x9fb4ff),
};

function makeMoonTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e9ecf5';
  ctx.fillRect(2, 2, 12, 12);
  ctx.fillRect(1, 4, 14, 8);
  ctx.fillRect(4, 1, 8, 14);
  ctx.fillStyle = '#c3c9d8';
  for (const [x, y, w] of [[4, 4, 2], [9, 3, 3], [6, 9, 3], [11, 9, 2], [3, 10, 1]] as const) ctx.fillRect(x, y, w, w);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface SkyState {
  sunDir: THREE.Vector3;
  elevation: number;
  daylight: number;
  night: number;
  golden: number;
  fogColor: THREE.Color;
  sunColor: THREE.Color;
}

export class SkySystem {
  readonly sky: Sky;
  readonly stars: THREE.Points;
  readonly moon: THREE.Mesh;
  readonly group = new THREE.Group();
  private starMat: THREE.ShaderMaterial;
  private moonMat: THREE.MeshBasicMaterial;
  readonly state: SkyState = {
    sunDir: new THREE.Vector3(1, 0, 0),
    elevation: 0,
    daylight: 1,
    night: 0,
    golden: 0,
    fogColor: new THREE.Color(),
    sunColor: new THREE.Color(),
  };
  private tmpC = new THREE.Color();
  private tmpC2 = new THREE.Color();
  readonly clouds: THREE.Mesh;
  private cloudMat: THREE.ShaderMaterial;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envMat: THREE.ShaderMaterial;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envTod = -1;
  private envStep = 0.008;
  private cloudOct = 4;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.sky = new Sky();
    this.sky.scale.setScalar(1400);
    // 扩展 Sky 着色器：白天整体增益（避免天空过曝发白）+ 夜晚蓝色调
    const sm = this.sky.material;
    sm.uniforms.uSkyGain = { value: 0.55 };
    sm.uniforms.uNight = { value: 0 };
    sm.uniforms.uNightColor = { value: new THREE.Color(0x070b1d) };
    sm.fragmentShader = sm.fragmentShader
      .replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float uSkyGain;\nuniform float uNight;\nuniform vec3 uNightColor;')
      .replace(
        'gl_FragColor = vec4( retColor, 1.0 );',
        'vec3 hkCol = retColor * uSkyGain;\n\t\t\thkCol = mix(hkCol, uNightColor + hkCol * 0.25, uNight);\n\t\t\tgl_FragColor = vec4( hkCol, 1.0 );',
      );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    // 星空
    const N = 1800;
    const pos = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    const size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(th) * 600;
      pos[i * 3 + 1] = u * 600;
      pos[i * 3 + 2] = r * Math.sin(th) * 600;
      phase[i] = Math.random() * 100;
      size[i] = Math.random() < 0.08 ? 3.2 : 1.2 + Math.random() * 1.4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.starMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uPR: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aPhase; attribute float aSize;
        uniform float uTime; uniform float uPR;
        varying float vTw;
        void main() {
          vTw = 0.6 + 0.4 * sin(uTime * 2.3 + aPhase);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPR;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; varying float vTw;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d));
          gl_FragColor = vec4(vec3(1.4, 1.45, 1.6) * vTw, a * uOpacity);
        }`,
    });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    this.group.add(this.stars);

    // 月亮
    this.moonMat = new THREE.MeshBasicMaterial({
      map: makeMoonTexture(),
      transparent: true,
      fog: false,
      depthWrite: false,
      color: new THREE.Color(2.2, 2.2, 2.4),
    });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), this.moonMat);
    this.moon.renderOrder = -8;
    this.moon.frustumCulled = false;
    this.group.add(this.moon);

    // 云层：跟随相机的高空平面，fBm + 自阴影 + 银边
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedUniforms.uTime,
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSkyCol: { value: new THREE.Color(0.4, 0.6, 0.9) },
        uHorizon: { value: new THREE.Color(0.8, 0.8, 0.8) },
        uDay: { value: 1 },
        uNight: { value: 0 },
        uGolden: { value: 0 },
        uCover: { value: 0.52 },
        uCam: { value: new THREE.Vector3() },
      },
      defines: { CLOUD_OCT: 4 },
      vertexShader: CLOUD_VS,
      fragmentShader: CLOUD_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(2800, 2800).rotateX(-Math.PI / 2), this.cloudMat);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -5;
    scene.add(this.clouds);

    // 天空环境光（PMREM）：给金属/湿润表面提供天空反射与漫反射环境光
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uSunVis: { value: 1 },
      },
      vertexShader: ENV_VS,
      fragmentShader: ENV_FS,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.envMat));

    scene.add(this.group);
  }

  /** 画质：云层倍频数（0 关闭）与环境光更新间隔 */
  setQuality(cloudOctaves: number, envStep: number) {
    this.envStep = envStep;
    this.clouds.visible = cloudOctaves > 0;
    if (cloudOctaves > 0 && cloudOctaves !== this.cloudOct) {
      this.cloudOct = cloudOctaves;
      this.cloudMat.defines.CLOUD_OCT = cloudOctaves;
      this.cloudMat.needsUpdate = true;
    }
    this.envTod = -1;
  }

  private updateEnv(t: number, renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    const dt = Math.abs(t - this.envTod);
    if (this.envTod >= 0 && Math.min(dt, 1 - dt) < this.envStep) return;
    this.envTod = t;
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 100, { size: 64 });
    scene.environment = this.envRT.texture;
    old?.dispose();
  }

  sunDirFromTime(t: number, out = new THREE.Vector3()) {
    const a = t * Math.PI * 2;
    return out.set(Math.cos(a), Math.sin(a), 0.32).normalize();
  }

  update(
    t: number,
    time: number,
    camera: THREE.Camera,
    lighting: Lighting,
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    water: WaterMaterial | null,
  ) {
    const s = this.state;
    this.sunDirFromTime(t, s.sunDir);
    const el = s.sunDir.y;
    s.elevation = el;
    s.daylight = smooth(-0.1, 0.22, el);
    s.night = smooth(0.02, -0.22, el);
    s.golden = (1 - smooth(0.06, 0.38, Math.abs(el))) * smooth(-0.18, 0.0, el);

    this.group.position.copy(camera.position);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(s.sunDir);
    u.turbidity.value = 3.2 + s.golden * 2.8;
    u.rayleigh.value = 1.4 + s.golden * 2.4 + s.night * 0.5;
    u.mieCoefficient.value = 0.004 + s.golden * 0.003;
    u.mieDirectionalG.value = 0.82;
    u.uSkyGain.value = 0.5 + s.golden * 0.3;
    u.uNight.value = s.night;

    // 星空随时间旋转
    this.stars.rotation.z = t * Math.PI * 2;
    this.starMat.uniforms.uTime.value = time;
    this.starMat.uniforms.uOpacity.value = s.night;
    this.stars.visible = s.night > 0.01;
    this.starMat.uniforms.uPR.value = renderer.getPixelRatio();

    // 月亮在太阳对面
    const moonDir = this.tmpVec.copy(s.sunDir).multiplyScalar(-1);
    this.moon.position.copy(moonDir).multiplyScalar(560);
    this.group.updateMatrixWorld();
    this.moon.lookAt(camera.position);
    this.moonMat.opacity = smooth(-0.1, 0.1, moonDir.y);
    this.moon.visible = this.moonMat.opacity > 0.01;

    // 雾颜色（与地平线同步）
    const fog = s.fogColor;
    fog.copy(PALETTE.fogDay).lerp(PALETTE.fogGold, s.golden * 0.85);
    fog.lerp(PALETTE.fogNight, s.night);
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(fog);

    // 主光：日/月
    const sunCol = s.sunColor.copy(PALETTE.sunNoon).lerp(PALETTE.sunGold, s.golden);
    if (el > -0.03) {
      lighting.setDirection(s.sunDir);
      lighting.sun.color.copy(sunCol);
      lighting.sun.intensity = 3.4 * smooth(-0.03, 0.12, el);
    } else {
      lighting.setDirection(moonDir);
      lighting.sun.color.copy(PALETTE.moon);
      lighting.sun.intensity = 0.55 * smooth(-0.03, 0.15, moonDir.y);
    }

    lighting.hemi.color.copy(PALETTE.hemiDay).lerp(PALETTE.hemiGold, s.golden * 0.7).lerp(PALETTE.hemiNight, s.night);
    lighting.hemi.groundColor.copy(PALETTE.groundDay).lerp(PALETTE.groundNight, s.night);
    lighting.hemi.intensity = 0.35 + 0.85 * s.daylight + s.night * 0.08;

    renderer.toneMappingExposure = 0.72 + s.night * 0.18 + s.golden * 0.1;

    // 天空颜色（天顶）
    const zenith = this.tmpC.copy(PALETTE.zenithDay).lerp(PALETTE.zenithGold, s.golden).lerp(PALETTE.zenithNight, s.night);

    // 云层
    const cu = this.cloudMat.uniforms;
    cu.uSunDir.value.copy(el > -0.03 ? s.sunDir : moonDir);
    cu.uSunColor.value.copy(el > -0.03 ? sunCol : PALETTE.moon).multiplyScalar(el > -0.03 ? 1 : 0.3);
    cu.uSkyCol.value.copy(zenith);
    cu.uHorizon.value.copy(fog);
    cu.uDay.value = s.daylight;
    cu.uNight.value = s.night;
    cu.uGolden.value = s.golden;
    cu.uCam.value.copy(camera.position);
    this.clouds.position.set(camera.position.x, 118, camera.position.z);

    // 环境光照（PMREM）：天顶/地平线/地面 + 太阳
    const eu = this.envMat.uniforms;
    eu.uZenith.value.copy(zenith).multiplyScalar(1.1);
    eu.uHorizon.value.copy(fog).multiplyScalar(0.9);
    eu.uGround.value.copy(PALETTE.groundDay).lerp(PALETTE.groundNight, s.night).multiplyScalar(0.6);
    eu.uSunDir.value.copy(el > -0.03 ? s.sunDir : moonDir);
    eu.uSunColor.value.copy(el > -0.03 ? sunCol : PALETTE.moon);
    eu.uSunVis.value = el > -0.03 ? smooth(-0.03, 0.12, el) : 0.15 * s.night;
    this.updateEnv(t, renderer, scene);
    scene.environmentIntensity = 0.35 + 0.85 * s.daylight;
    lighting.hemi.intensity *= 0.8;

    // 方块材质：日出湿润高光、晨雾（高度雾）、低处雾色
    const morning = t > 0.85 || t < 0.3 ? 1 : 0.35;
    blockUniforms.uWet.value = Math.min(1, s.golden * 1.4) * morning;
    blockUniforms.uHeightFog.value = 0.06 + s.golden * 0.32 * morning + s.night * 0.08;
    blockUniforms.uFogColorLow.value.copy(fog).lerp(sunCol, s.golden * 0.25 * s.daylight).multiplyScalar(1.05);

    if (water) {
      const wu = water.uniforms;
      wu.uSunDir.value.copy(el > -0.03 ? s.sunDir : moonDir);
      wu.uSunColor.value.copy(el > -0.03 ? sunCol : PALETTE.moon);
      wu.uSunVis.value = el > -0.03 ? smooth(-0.03, 0.1, el) : 0.25 * s.night;
      wu.uHorizon.value.copy(fog);
      wu.uSky.value.copy(zenith);
      wu.uDaylight.value = s.daylight;
      wu.fogColor.value.copy(fog);
    }
    void this.tmpC2;
  }

  private tmpVec = new THREE.Vector3();

  /** 时钟文本：t=0 → 06:00 */
  static clock(t: number) {
    const minutes = Math.floor(((t * 24 + 6) % 24) * 60);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
