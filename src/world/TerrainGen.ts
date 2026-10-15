import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { B } from './Blocks';
import { Chunk, CHUNK_X, CHUNK_Y, CHUNK_Z, idx } from './Chunk';

/** 种子化地形生成：高度场 + 生物群系 + 树木 + 花草 */

export const SEA_LEVEL = 20;

export type Biome = 'plains' | 'forest' | 'desert' | 'snowy';

export const BIOME_ZH: Record<Biome, string> = {
  plains: '平原',
  forest: '森林',
  desert: '沙漠',
  snowy: '雪原',
};

export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Column {
  h: number;
  biome: Biome;
  temp: number;
  moist: number;
}

const MARGIN = 3; // 树冠跨区块的边距

export class TerrainGen {
  readonly seed: number;
  private nCont: NoiseFunction2D;
  private nHill: NoiseFunction2D;
  private nDetail: NoiseFunction2D;
  private nTemp: NoiseFunction2D;
  private nMoist: NoiseFunction2D;
  private nRidge: NoiseFunction2D;

  constructor(seed: number) {
    this.seed = seed;
    const r = mulberry32(seed);
    this.nCont = createNoise2D(r);
    this.nHill = createNoise2D(r);
    this.nDetail = createNoise2D(r);
    this.nTemp = createNoise2D(r);
    this.nMoist = createNoise2D(r);
    this.nRidge = createNoise2D(r);
  }

  /** 整数坐标哈希 → [0,1) */
  hash(x: number, z: number, salt = 0): number {
    let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(this.seed ^ salt, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  column(x: number, z: number): Column {
    const temp = this.nTemp(x * 0.0016, z * 0.0016) + this.nDetail(x * 0.02, z * 0.02) * 0.04;
    const moist = this.nMoist(x * 0.0019 + 40, z * 0.0019 - 30);
    const cont =
      this.nCont(x * 0.0035, z * 0.0035) * 0.7 + this.nCont(x * 0.009 + 11, z * 0.009 - 7) * 0.3;
    const hill = this.nHill(x * 0.021, z * 0.021) * 0.6 + this.nHill(x * 0.05, z * 0.05) * 0.25;
    const detail = this.nDetail(x * 0.09, z * 0.09) * 0.15;

    const snowF = smooth(-0.25, -0.5, temp);
    const desertF = smooth(0.25, 0.5, temp) * smooth(0.05, -0.2, moist);
    const ridge = 1 - Math.abs(this.nRidge(x * 0.012, z * 0.012));

    let h = 23 + cont * 9 + hill * 4.5 * (1 - desertF * 0.6) + detail * 2;
    h += snowF * (ridge * ridge * 14 + 3);
    h = Math.max(4, Math.min(CHUNK_Y - 10, Math.round(h)));

    let biome: Biome = 'plains';
    if (snowF > 0.5) biome = 'snowy';
    else if (desertF > 0.5) biome = 'desert';
    else if (moist > 0.15) biome = 'forest';
    return { h, biome, temp, moist };
  }

  biomeAt(x: number, z: number): Biome {
    return this.column(Math.floor(x), Math.floor(z)).biome;
  }

  /** 生成一个区块的方块数据 */
  generate(chunk: Chunk) {
    const ox = chunk.cx * CHUNK_X;
    const oz = chunk.cz * CHUNK_Z;
    const W = CHUNK_X + MARGIN * 2;
    const D = CHUNK_Z + MARGIN * 2;
    const cols: Column[] = new Array(W * D);
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) cols[z * W + x] = this.column(ox + x - MARGIN, oz + z - MARGIN);

    const data = chunk.data;
    data.fill(0);

    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const c = cols[(z + MARGIN) * W + (x + MARGIN)];
        const wx = ox + x, wz = oz + z;
        const h = c.h;
        const beach = h <= SEA_LEVEL + 1;
        for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
          let id: number = B.AIR;
          if (y === 0) id = B.BEDROCK;
          else if (y === 1 && this.hash(wx, wz, 3) < 0.5) id = B.BEDROCK;
          else if (y <= h) {
            const depth = h - y;
            if (depth === 0) {
              if (h < SEA_LEVEL - 1) id = this.hash(wx, wz, 9) < 0.3 ? B.GRAVEL : B.SAND;
              else if (c.biome === 'desert' || beach) id = B.SAND;
              else if (c.biome === 'snowy') id = h > 36 && this.hash(wx, wz, 5) < 0.3 ? B.STONE : B.SNOW;
              else id = B.GRASS;
            } else if (depth < 4) {
              if (c.biome === 'desert' || beach) id = depth < 3 ? B.SAND : B.STONE;
              else id = B.DIRT;
            } else id = B.STONE;
          } else if (y <= SEA_LEVEL) id = B.WATER;
          data[idx(x, y, z)] = id;
        }

        // 花草
        if (h > SEA_LEVEL && h + 1 < CHUNK_Y) {
          const top = data[idx(x, h, z)];
          if (top === B.GRASS) {
            const r = this.hash(wx, wz, 77);
            const dense = c.biome === 'forest' ? 0.22 : 0.3;
            if (r < 0.025) data[idx(x, h + 1, z)] = B.FLOWER_RED;
            else if (r < 0.05) data[idx(x, h + 1, z)] = B.FLOWER_YELLOW;
            else if (r < dense) data[idx(x, h + 1, z)] = B.TALL_GRASS;
          }
        }
      }
    }

    // 树木（扫描含边距的列，只写入本区块内部的方块）
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const c = cols[z * W + x];
        if (c.h <= SEA_LEVEL + 1) continue;
        if (c.biome === 'desert') continue;
        const wx = ox + x - MARGIN, wz = oz + z - MARGIN;
        const density = c.biome === 'forest' ? 0.045 : c.biome === 'snowy' ? 0.012 : 0.006;
        if (this.hash(wx, wz, 101) >= density) continue;
        // 避免过密：同一 3x3 中仅保留哈希最小者
        let isMin = true;
        const me = this.hash(wx, wz, 101);
        for (let dz = -1; dz <= 1 && isMin; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            if (this.hash(wx + dx, wz + dz, 101) < me) { isMin = false; break; }
          }
        if (!isMin) continue;
        this.placeTree(chunk, x - MARGIN, c.h + 1, z - MARGIN, wx, wz, c.biome === 'snowy');
      }
    }

    for (let z = 0; z < CHUNK_Z; z++) for (let x = 0; x < CHUNK_X; x++) chunk.recomputeHeight(x, z);
    chunk.generated = true;
  }

  private placeTree(chunk: Chunk, lx: number, by: number, lz: number, wx: number, wz: number, snowy: boolean) {
    const height = 4 + Math.floor(this.hash(wx, wz, 202) * 3);
    const top = by + height;
    if (top + 2 >= CHUNK_Y) return;
    const put = (x: number, y: number, z: number, id: number, onlyAir: boolean) => {
      if (x < 0 || z < 0 || x >= CHUNK_X || z >= CHUNK_Z || y < 0 || y >= CHUNK_Y) return;
      const i = idx(x, y, z);
      const cur = chunk.data[i];
      if (onlyAir && cur !== B.AIR && cur !== B.TALL_GRASS && cur !== B.FLOWER_RED && cur !== B.FLOWER_YELLOW) return;
      chunk.data[i] = id;
    };
    // 树冠
    if (snowy) {
      // 云杉造型
      for (let y = by + 2; y <= top + 1; y++) {
        const r = Math.max(0, Math.round((top + 1 - y) * 0.6)) % 3;
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > r + 0.5) continue;
            put(lx + dx, y, lz + dz, B.LEAVES, true);
          }
      }
      put(lx, top + 2, lz, B.LEAVES, true);
    } else {
      for (let y = top - 2; y <= top + 1; y++) {
        const r = y >= top ? 1 : 2;
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            const corner = Math.abs(dx) === r && Math.abs(dz) === r;
            if (corner && (y === top + 1 || this.hash(wx + dx * 31, wz + dz * 17, y) < 0.55)) continue;
            put(lx + dx, y, lz + dz, B.LEAVES, true);
          }
      }
    }
    for (let y = by; y < top; y++) put(lx, y, lz, B.LOG, false);
    // 树根处如果是草方块则变泥土
    if (lx >= 0 && lz >= 0 && lx < CHUNK_X && lz < CHUNK_Z) {
      const i = idx(lx, by - 1, lz);
      if (chunk.data[i] === B.GRASS) chunk.data[i] = B.DIRT;
    }
  }
}
