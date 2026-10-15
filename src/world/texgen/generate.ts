import { TILES, type Px, type TileName } from './painters';
import { hash2 } from './noise';

/** 一张贴图的三层数据（RGBA8，行优先，第 0 行 = 图像顶部） */
export interface TileData {
  size: number;
  albedo: Uint8Array;
  /** RGB 切线空间法线，A = 缝隙 AO */
  normal: Uint8Array;
  /** R 金属度，G 粗糙度，B 自发光，A 湿润度 */
  mer: Uint8Array;
}

const px: Px = { r: 0, g: 0, b: 0, a: 1, h: 0, rough: 1, metal: 0, emit: 0, wet: 0 };
const to8 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0);

/** 以分辨率 S 生成一张贴图（S ≥ 32 时直接计算；更低分辨率由上层下采样得到） */
export function generateTile(name: TileName, S: number): TileData {
  const spec = TILES[name];
  const N = S * S;
  const albedo = new Uint8Array(N * 4);
  const normal = new Uint8Array(N * 4);
  const mer = new Uint8Array(N * 4);
  const H = new Float32Array(N);
  const inv = 1 / S;
  const pixK = spec.pixel * 2;
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) * inv;
    const py = Math.floor(v * 16);
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) * inv;
      spec.paint(u, v, px);
      const k = pixK ? 1 + (hash2(Math.floor(u * 16), py, 977) - 0.5) * pixK : 1;
      const i = y * S + x, o = i * 4;
      albedo[o] = to8(px.r * k);
      albedo[o + 1] = to8(px.g * k);
      albedo[o + 2] = to8(px.b * k);
      albedo[o + 3] = px.a >= 0.5 ? 255 : 0;
      mer[o] = to8(px.metal);
      mer[o + 1] = to8(px.rough);
      mer[o + 2] = to8(px.emit);
      mer[o + 3] = to8(px.wet);
      H[i] = px.h;
    }
  }
  // 高度 → 法线（Sobel，周期边界）+ 缝隙 AO
  const str = spec.normal / 64;
  const r = Math.max(1, Math.round(S / 64));
  const blur = boxBlurWrap(H, S, r);
  for (let y = 0; y < S; y++) {
    const ym = ((y - 1 + S) % S) * S, y0 = y * S, yp = ((y + 1) % S) * S;
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S, xp = (x + 1) % S;
      const dx = (H[ym + xp] + 2 * H[y0 + xp] + H[yp + xp] - H[ym + xm] - 2 * H[y0 + xm] - H[yp + xm]) * 0.125 * S;
      const dyImg = (H[yp + xm] + 2 * H[yp + x] + H[yp + xp] - H[ym + xm] - 2 * H[ym + x] - H[ym + xp]) * 0.125 * S;
      // 纹理 v 向上：dh/dv = -dh/dy_img
      let nx = -dx * str, ny = dyImg * str, nz = 1;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= l; ny *= l; nz *= l;
      const i = y0 + x, o = i * 4;
      normal[o] = to8(nx * 0.5 + 0.5);
      normal[o + 1] = to8(ny * 0.5 + 0.5);
      normal[o + 2] = to8(nz * 0.5 + 0.5);
      const cav = 1 - Math.max(0, blur[i] - H[i]) * 2.2;
      normal[o + 3] = to8(cav < 0.45 ? 0.45 : cav);
    }
  }
  return { size: S, albedo, normal, mer };
}

function boxBlurWrap(src: Float32Array, S: number, r: number): Float32Array {
  const tmp = new Float32Array(S * S), out = new Float32Array(S * S);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += src[y * S + ((x + d + S) % S)];
      tmp[y * S + x] = s * k;
    }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += tmp[((y + d + S) % S) * S + x];
      out[y * S + x] = s * k;
    }
  return out;
}

/** 盒式下采样（整数倍），alpha 用多数表决保持镂空清晰 */
export function downsample(t: TileData, S: number): TileData {
  const f = t.size / S;
  if (f === 1) return t;
  const N = S * S;
  const out: TileData = { size: S, albedo: new Uint8Array(N * 4), normal: new Uint8Array(N * 4), mer: new Uint8Array(N * 4) };
  const cnt = f * f;
  for (const key of ['albedo', 'normal', 'mer'] as const) {
    const src = t[key], dst = out[key];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        let a0 = 0, a1 = 0, a2 = 0, a3 = 0, w = 0;
        for (let j = 0; j < f; j++)
          for (let i = 0; i < f; i++) {
            const o = ((y * f + j) * t.size + x * f + i) * 4;
            const vis = key === 'albedo' ? (src[o + 3] > 127 ? 1 : 0) : 1;
            a0 += src[o] * vis; a1 += src[o + 1] * vis; a2 += src[o + 2] * vis; a3 += src[o + 3];
            w += vis;
          }
        const o = (y * S + x) * 4;
        const ww = w || 1;
        dst[o] = a0 / ww; dst[o + 1] = a1 / ww; dst[o + 2] = a2 / ww;
        dst[o + 3] = key === 'albedo' ? (w * 2 >= cnt ? 255 : 0) : a3 / cnt;
      }
  }
  return out;
}
