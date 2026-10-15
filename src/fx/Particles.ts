import * as THREE from 'three';

/**
 * 粒子：方块破坏碎屑（InstancedMesh 小方块，带重力与地面反弹）、
 * 白天的漂浮尘埃（暖色光斑）与夜晚萤火虫（HDR 发光 → 辉光）。
 */

interface Debris {
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: THREE.Euler;
  w: THREE.Vector3;
  life: number;
  max: number;
  s: number;
  c: THREE.Color;
}

export class BlockBurst {
  readonly mesh: THREE.InstancedMesh;
  private items: Debris[] = [];
  private max = 320;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private sc = new THREE.Vector3();
  private col = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    this.mesh = new THREE.InstancedMesh(g, mat, this.max);
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // 预创建 instanceColor
    for (let i = 0; i < this.max; i++) this.mesh.setColorAt(i, this.col.set(1, 1, 1));
    scene.add(this.mesh);
  }

  emit(x: number, y: number, z: number, color: number, count = 22, glow = 0) {
    for (let i = 0; i < count; i++) {
      if (this.items.length >= this.max) this.items.shift();
      const life = 0.6 + Math.random() * 0.7;
      this.items.push({
        p: new THREE.Vector3(x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6),
        v: new THREE.Vector3((Math.random() - 0.5) * 4.5, Math.random() * 4.5 + 1.5, (Math.random() - 0.5) * 4.5),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        w: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
        life,
        max: life,
        s: 0.08 + Math.random() * 0.1,
        c: new THREE.Color(color).multiplyScalar((0.7 + Math.random() * 0.45) * (1 + glow)),
      });
    }
  }

  update(dt: number, solid: (x: number, y: number, z: number) => boolean) {
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const d = items[i];
      d.life -= dt;
      if (d.life <= 0) {
        items.splice(i, 1);
        continue;
      }
      d.v.y -= 18 * dt;
      const ny = d.p.y + d.v.y * dt;
      if (solid(Math.floor(d.p.x), Math.floor(ny), Math.floor(d.p.z))) {
        d.v.y *= -0.3;
        d.v.x *= 0.6;
        d.v.z *= 0.6;
        d.w.multiplyScalar(0.5);
      } else d.p.y = ny;
      d.p.x += d.v.x * dt;
      d.p.z += d.v.z * dt;
      d.r.x += d.w.x * dt;
      d.r.y += d.w.y * dt;
      d.r.z += d.w.z * dt;
    }
    for (let i = 0; i < items.length; i++) {
      const d = items[i];
      const s = d.s * Math.min(1, d.life / (d.max * 0.35));
      this.q.setFromEuler(d.r);
      this.sc.set(s, s, s);
      this.m.compose(d.p, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, d.c);
    }
    this.mesh.count = items.length;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** 环境光点（尘埃 / 萤火虫）共用着色器 */
function glowPointsMaterial(color: THREE.Color, size: number, blink: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: color },
      uOpacity: { value: 0 },
      uSize: { value: size },
      uBlink: { value: blink },
      uPR: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime; uniform float uSize; uniform float uBlink; uniform float uPR;
      varying float vA;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.5 + aPhase * 7.0) * 0.6;
        p.y += sin(uTime * 0.7 + aPhase * 3.0) * 0.4;
        p.z += cos(uTime * 0.4 + aPhase * 5.0) * 0.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float b = mix(1.0, pow(0.5 + 0.5 * sin(uTime * 2.2 + aPhase * 11.0), 3.0), uBlink);
        vA = b;
        gl_PointSize = uSize * uPR * (40.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        gl_FragColor = vec4(uColor * (0.6 + 0.4 * vA), a * uOpacity * vA);
      }`,
  });
}

class FloatingPoints {
  readonly points: THREE.Points;
  readonly mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private n: number;
  private range: number;
  private vy: number;

  constructor(n: number, range: number, color: THREE.Color, size: number, blink: number, vy: number) {
    this.n = n;
    this.range = range;
    this.vy = vy;
    this.pos = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * range * 2;
      this.pos[i * 3 + 1] = Math.random() * 12;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * range * 2;
      phase[i] = Math.random() * 10;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.mat = glowPointsMaterial(color, size, blink);
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }

  /** 让粒子围绕焦点循环分布；ground(x,z) 返回地表高度 */
  update(dt: number, time: number, focus: THREE.Vector3, opacity: number, pr: number, ground: (x: number, z: number) => number, heightBand: [number, number]) {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uOpacity.value = opacity;
    this.mat.uniforms.uPR.value = pr;
    this.points.visible = opacity > 0.01;
    if (!this.points.visible) return;
    const R = this.range;
    const p = this.pos;
    let changed = false;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      p[o + 1] += this.vy * dt;
      let dx = p[o] - focus.x, dz = p[o + 2] - focus.z;
      let reset = false;
      if (dx > R) { p[o] -= R * 2; reset = true; } else if (dx < -R) { p[o] += R * 2; reset = true; }
      if (dz > R) { p[o + 2] -= R * 2; reset = true; } else if (dz < -R) { p[o + 2] += R * 2; reset = true; }
      const gy = ground(p[o], p[o + 2]);
      if (reset || p[o + 1] > gy + heightBand[1] || p[o + 1] < gy + heightBand[0] - 1) {
        p[o + 1] = gy + heightBand[0] + Math.random() * (heightBand[1] - heightBand[0]);
      }
      changed = true;
      void dx; void dz;
    }
    if (changed) (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class AmbientParticles {
  readonly motes: FloatingPoints;
  readonly fireflies: FloatingPoints;
  private groundCache = new Map<number, number>();
  private frame = 0;

  constructor(scene: THREE.Scene, density: number) {
    this.motes = new FloatingPoints(Math.round(420 * density), 22, new THREE.Color(1.6, 1.35, 0.95), 1.6, 0.2, 0.08);
    this.fireflies = new FloatingPoints(Math.round(160 * density), 20, new THREE.Color(2.6, 3.2, 0.9), 2.8, 1, 0);
    scene.add(this.motes.points, this.fireflies.points);
  }

  update(dt: number, time: number, focus: THREE.Vector3, daylight: number, night: number, golden: number, pr: number, surface: (x: number, z: number) => number) {
    // 地表高度缓存（每 2 秒清空，避免编辑后不同步）
    if (++this.frame % 120 === 0) this.groundCache.clear();
    const ground = (x: number, z: number) => {
      const k = (Math.floor(x) & 0xffff) * 65536 + (Math.floor(z) & 0xffff);
      let h = this.groundCache.get(k);
      if (h === undefined) {
        h = surface(x, z) + 1;
        this.groundCache.set(k, h);
      }
      return h;
    };
    this.motes.update(dt, time, focus, Math.min(1, daylight * 0.55 + golden * 0.6), pr, ground, [0.5, 9]);
    this.fireflies.update(dt, time, focus, night, pr, ground, [0.4, 3.2]);
  }
}
