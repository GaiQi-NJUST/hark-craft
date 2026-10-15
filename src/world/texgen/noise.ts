/**
 * 可平铺（周期）噪声工具：值噪声 fBm、Worley 细胞噪声、颜色插值。
 * 纯函数，无 DOM 依赖（可在 Node 下运行做基准测试）。
 */

export function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** 周期值噪声：x,y 为格点坐标，period 为整数周期 */
export function vnoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = fade(x - x0), fy = fade(y - y0);
  const ax = mod(x0, period), bx = mod(x0 + 1, period);
  const ay = mod(y0, period), by = mod(y0 + 1, period);
  const a = hash2(ax, ay, seed), b = hash2(bx, ay, seed);
  const c = hash2(ax, by, seed), d = hash2(bx, by, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** 平铺 fBm：u,v ∈ [0,1)，freq 为整数基频 */
export function fbm(u: number, v: number, freq: number, oct: number, seed: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, f = freq;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(u * f, v * f, f, seed + i * 101) * amp;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** 各向异性 fBm（木纹等）：x/y 方向不同频率 */
export function fbm2(u: number, v: number, fx: number, fy: number, oct: number, seed: number): number {
  let sum = 0, amp = 1, norm = 0, a = fx, b = fy;
  for (let i = 0; i < oct; i++) {
    // 用 x 周期近似：两个方向分别取整周期
    const px = u * a, py = v * b;
    const per = Math.max(1, Math.round(a));
    const perY = Math.max(1, Math.round(b));
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const tx = fade(px - x0), ty = fade(py - y0);
    const s = seed + i * 131;
    const h00 = hash2(mod(x0, per), mod(y0, perY), s), h10 = hash2(mod(x0 + 1, per), mod(y0, perY), s);
    const h01 = hash2(mod(x0, per), mod(y0 + 1, perY), s), h11 = hash2(mod(x0 + 1, per), mod(y0 + 1, perY), s);
    sum += (h00 + (h10 - h00) * tx + (h01 - h00) * ty + (h00 - h10 - h01 + h11) * tx * ty) * amp;
    norm += amp;
    amp *= 0.5;
    a *= 2;
    b *= 2;
  }
  return sum / norm;
}

export interface WorleyOut {
  f1: number;
  f2: number;
  id: number;
  /** 最近特征点相对位置 */
  dx: number;
  dy: number;
}

/** 周期 Worley：cells 个格子，jitter 0..1 */
export function worley(u: number, v: number, cells: number, seed: number, out: WorleyOut, jitter = 0.85): WorleyOut {
  const x = u * cells, y = v * cells;
  const cx = Math.floor(x), cy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0, bdx = 0, bdy = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      const wx = mod(gx, cells), wy = mod(gy, cells);
      const px = gx + 0.5 + (hash2(wx, wy, seed) - 0.5) * jitter;
      const py = gy + 0.5 + (hash2(wx, wy, seed + 7) - 0.5) * jitter;
      const dx = px - x, dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = wy * cells + wx;
        bdx = dx;
        bdy = dy;
      } else if (d < f2) f2 = d;
    }
  out.f1 = f1;
  out.f2 = f2;
  out.id = id;
  out.dx = bdx;
  out.dy = bdy;
  return out;
}

export type RGB = [number, number, number];

export function hex(h: number): RGB {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function mixRGB(a: RGB, b: RGB, t: number, out: RGB = [0, 0, 0]): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

/** 多段渐变：stops 均匀分布 */
export function ramp(stops: RGB[], t: number, out: RGB = [0, 0, 0]): RGB {
  const n = stops.length - 1;
  const x = Math.min(0.99999, Math.max(0, t)) * n;
  const i = Math.floor(x);
  return mixRGB(stops[i], stops[i + 1], x - i, out);
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
