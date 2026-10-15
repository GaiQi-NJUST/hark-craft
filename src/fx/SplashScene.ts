import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BLOCKS, B } from '../world/Blocks';
import { getAtlas } from '../world/TextureAtlas';
import { layoutText } from '../ui/pixelFont';

/**
 * 开场动画（约 6.4s，之后由引擎接管“推入日出世界”的镜头）：
 * 黑暗中数百个发光方块飞来拼成巨型 3D 方块字 “HARK”（草/石/金/荧石），
 * 金色轮廓光扫过 + 辉光 + 体积光 + 尘埃，镜头环绕；随后文字碎裂、方块如雨坠落，金色闪白。
 */

export const SPLASH_DURATION = 6.4;

/** 把 BoxGeometry 的 UV 映射到图集中对应方块的贴图 */
export function blockBoxGeometry(id: number, size = 1): THREE.BoxGeometry {
  const atlas = getAtlas();
  const g = new THREE.BoxGeometry(size, size, size);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const def = BLOCKS[id];
  for (let face = 0; face < 6; face++) {
    const tile = face === 2 ? def.tiles.top : face === 3 ? def.tiles.bottom : def.tiles.side;
    const r = atlas.uv(tile);
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
    }
  }
  uv.needsUpdate = true;
  return g;
}

interface Cube {
  mesh: number;
  index: number;
  target: THREE.Vector3;
  start: THREE.Vector3;
  rot0: THREE.Quaternion;
  delay: number;
  dur: number;
  fallV: THREE.Vector3;
  spin: THREE.Vector3;
  arrived: boolean;
}

const easeOutBack = (x: number) => {
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export class SplashScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private meshes: THREE.InstancedMesh[] = [];
  private baseColors: THREE.Color[] = [];
  private cubes: Cube[] = [];
  private orb: THREE.Sprite;
  private rim: THREE.DirectionalLight;
  private sweep: THREE.PointLight;
  private dust: THREE.Points;
  private dustMat: THREE.PointsMaterial;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private qI = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private c = new THREE.Color();
  private env: THREE.Texture | null = null;
  private shattered = false;
  readonly orbWorld = new THREE.Vector3(0, 4, -42);

  constructor(renderer: THREE.WebGLRenderer) {
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    this.scene.background = new THREE.Color(0x04060b);
    this.scene.fog = new THREE.FogExp2(0x04060b, 0.011);

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.45;

    const atlas = getAtlas();
    const mats = [B.GRASS, B.STONE, B.GOLD, B.GLOWSTONE];
    const params: { rough: number; metal: number; emissive: number }[] = [
      { rough: 0.85, metal: 0, emissive: 0 },
      { rough: 0.7, metal: 0.05, emissive: 0 },
      { rough: 0.28, metal: 0.9, emissive: 0.05 },
      { rough: 0.6, metal: 0, emissive: 0.7 },
    ];

    const CUBE = 0.5;
    const { pts, width } = layoutText('HARK', 1.4);
    const depthLayers = 3;
    // 每个像素拆成 2x2 小方块
    const perMesh: Cube[][] = [[], [], [], []];
    const rnd = Math.random;
    for (const pt of pts) {
      for (let sy = 0; sy < 2; sy++)
        for (let sx = 0; sx < 2; sx++)
          for (let d = 0; d < depthLayers; d++) {
            let mi = pt.letter; // H 草 / A 石 / R 金 / K 荧石
            if (rnd() < 0.07) mi = 3;
            if (mi !== 3 && d === 0 && rnd() < 0.04) mi = 2;
            const tx = (pt.x + sx * 0.5 - width / 2 + 0.25) * 1.0;
            const ty = (3.5 - pt.y - sy * 0.5) * 1.0;
            const tz = (d - (depthLayers - 1) / 2) * CUBE;
            const dir = new THREE.Vector3(rnd() - 0.5, rnd() - 0.3, rnd() - 0.2).normalize();
            const start = dir.multiplyScalar(40 + rnd() * 40).add(new THREE.Vector3(0, 0, 10));
            const rot0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 8, rnd() * 8, rnd() * 8));
            perMesh[mi].push({
              mesh: mi,
              index: 0,
              target: new THREE.Vector3(tx, ty, tz),
              start,
              rot0,
              delay: 0.25 + pt.letter * 0.32 + (pt.x % 6) * 0.03 + rnd() * 0.85,
              dur: 1.1 + rnd() * 0.6,
              fallV: new THREE.Vector3(),
              spin: new THREE.Vector3((rnd() - 0.5) * 10, (rnd() - 0.5) * 10, (rnd() - 0.5) * 10),
              arrived: false,
            });
          }
    }

    mats.forEach((id, mi) => {
      const pr = params[mi];
      const mat = new THREE.MeshStandardMaterial({
        map: atlas.texture,
        roughness: pr.rough,
        metalness: pr.metal,
        emissive: new THREE.Color(1, 1, 1),
        emissiveMap: pr.emissive > 0 ? atlas.texture : null,
        emissiveIntensity: pr.emissive,
      });
      if (pr.emissive === 0) mat.emissive.setRGB(0, 0, 0);
      const list = perMesh[mi];
      const mesh = new THREE.InstancedMesh(blockBoxGeometry(id, CUBE * 0.98), mat, Math.max(1, list.length));
      mesh.count = list.length;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      list.forEach((cube, i) => {
        cube.index = i;
        mesh.setColorAt(i, this.c.setRGB(1, 1, 1));
        this.cubes.push(cube);
      });
      this.meshes.push(mesh);
      this.baseColors.push(new THREE.Color(1, 1, 1));
      this.scene.add(mesh);
    });

    // 背后的光球：体积光光源
    const orbTex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const ctx = cv.getContext('2d')!;
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,240,200,1)');
      g.addColorStop(0.2, 'rgba(255,200,120,0.85)');
      g.addColorStop(0.5, 'rgba(255,150,60,0.25)');
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: orbTex, color: new THREE.Color(2.0, 1.4, 0.8), transparent: true, depthWrite: false, fog: false }));
    this.orb.position.copy(this.orbWorld);
    this.orb.scale.setScalar(26);
    this.scene.add(this.orb);

    this.scene.add(new THREE.AmbientLight(0x404a66, 0.25));
    const key = new THREE.DirectionalLight(0xfff0dd, 1.1);
    key.position.set(-6, 10, 18);
    this.scene.add(key);
    this.rim = new THREE.DirectionalLight(0xffb347, 7);
    this.rim.position.set(4, 6, -20);
    this.scene.add(this.rim);
    this.sweep = new THREE.PointLight(0xffc56b, 0, 40, 1.6);
    this.scene.add(this.sweep);

    // 尘埃
    const N = 900;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (rnd() - 0.5) * 70;
      pos[i * 3 + 1] = (rnd() - 0.5) * 36;
      pos[i * 3 + 2] = (rnd() - 0.5) * 60;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dotTex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 32;
      const ctx = cv.getContext('2d')!;
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(cv);
    })();
    this.dustMat = new THREE.PointsMaterial({
      map: dotTex,
      size: 0.22,
      color: new THREE.Color(2.2, 1.6, 0.9),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(dg, this.dustMat);
    this.scene.add(this.dust);
  }

  reset() {
    this.shattered = false;
    for (const c of this.cubes) c.arrived = false;
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  /** 返回体积光强度 */
  update(t: number, dt: number): { rays: number; fade: number } {
    // 镜头环绕 + 推近
    const orbitA = -0.55 + easeInOut(clamp01(t / SPLASH_DURATION)) * 0.95;
    const radius = 44 - easeInOut(clamp01(t / 4.5)) * 12 + clamp01((t - 5) / 1.4) * 6;
    const camY = 2 + Math.sin(t * 0.5) * 1.5 - clamp01((t - 5) / 1.4) * 4;
    this.camera.position.set(Math.sin(orbitA) * radius, camY, Math.cos(orbitA) * radius);
    this.camera.lookAt(0, 0.3 - clamp01((t - 5.2) / 1.2) * 3, 0);

    const shatterT = 5.15;
    if (t >= shatterT && !this.shattered) {
      this.shattered = true;
      for (const c of this.cubes) {
        const out = c.target.clone().setY(c.target.y * 0.4).normalize();
        c.fallV.set(out.x * (3 + Math.random() * 6), 2 + Math.random() * 5, out.z * 3 + (Math.random() - 0.3) * 6);
      }
    }

    for (const c of this.cubes) {
      const mesh = this.meshes[c.mesh];
      let flash = 0;
      if (!this.shattered) {
        const k = clamp01((t - c.delay) / c.dur);
        const e = easeOutBack(k);
        this.p.lerpVectors(c.start, c.target, e);
        // 飞行弧线
        this.p.y += Math.sin(k * Math.PI) * 4 * (1 - k);
        this.q.slerpQuaternions(c.rot0, this.qI, Math.min(1, k * 1.15));
        if (k >= 1 && !c.arrived) c.arrived = true;
        flash = k >= 1 ? Math.max(0, 0.9 - (t - (c.delay + c.dur)) * 2.0) : k > 0 ? 0.12 : 0;
        // 金色光扫过
        const sweepX = -16 + clamp01((t - 3.0) / 1.8) * 32;
        const dx = Math.abs(c.target.x - sweepX);
        flash += Math.max(0, 1 - dx / 2.5) * 0.9 * (t > 3 && t < 5 ? 1 : 0);
        const sc = k <= 0 ? 0 : 1;
        this.s.setScalar(sc);
      } else {
        const ft = t - shatterT;
        this.p.copy(c.target).addScaledVector(c.fallV, ft);
        this.p.y -= 0.5 * 22 * ft * ft;
        this.q.setFromEuler(new THREE.Euler(c.spin.x * ft, c.spin.y * ft, c.spin.z * ft));
        flash = Math.max(0, 0.5 - ft * 1.2);
        this.s.setScalar(1);
      }
      this.m.compose(this.p, this.q, this.s);
      mesh.setMatrixAt(c.index, this.m);
      const base = c.mesh === 2 ? 1.0 : 1.0;
      this.c.setRGB(base + flash * 1.6, base + flash * 1.2, base + flash * 0.55);
      mesh.setColorAt(c.index, this.c);
    }
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // 灯光动画
    const sweepK = clamp01((t - 2.8) / 2.2);
    this.sweep.position.set(-18 + sweepK * 36, 4, 6);
    this.sweep.intensity = Math.sin(sweepK * Math.PI) * 70;
    this.rim.intensity = 1.5 + clamp01((t - 1.5) / 1.5) * 4;
    const orbK = clamp01((t - 0.8) / 2.5) * (1 - clamp01((t - 5.6) / 0.8) * 0.3);
    (this.orb.material as THREE.SpriteMaterial).opacity = orbK;
    this.orb.scale.setScalar(14 + orbK * 8 + Math.sin(t * 2) * 0.5);

    this.dustMat.opacity = clamp01(t / 1.2) * 0.9;
    this.dust.rotation.y += dt * 0.03;
    this.dust.position.y = Math.sin(t * 0.3) * 0.5;

    const fadeIn = 1 - clamp01(t / 0.9);
    const fadeOut = clamp01((t - 5.7) / 0.7);
    return { rays: orbK * 0.9, fade: Math.max(fadeIn, fadeOut) };
  }

  dispose() {
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.env?.dispose();
  }
}
