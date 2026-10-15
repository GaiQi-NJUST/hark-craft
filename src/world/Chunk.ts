import type * as THREE from 'three';

export const CHUNK_X = 16;
export const CHUNK_Z = 16;
export const CHUNK_Y = 48;
export const CHUNK_VOL = CHUNK_X * CHUNK_Y * CHUNK_Z;

/** 局部坐标 → 数组下标：y 最外层，便于按层遍历 */
export const idx = (x: number, y: number, z: number) => (y * CHUNK_Z + z) * CHUNK_X + x;

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly key: string;
  readonly data = new Uint8Array(CHUNK_VOL);
  /** 每列最高的非空气方块（用于萤火虫/出生点等） */
  readonly heightMap = new Uint8Array(CHUNK_X * CHUNK_Z);
  generated = false;
  /** 区块内光源方块数量（为 0 时可跳过方块光计算） */
  lightCount = 0;
  dirty = true;
  meshes: { opaque?: THREE.Mesh; cutout?: THREE.Mesh; water?: THREE.Mesh } = {};

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    this.key = chunkKey(cx, cz);
  }

  get(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_Y) return 0;
    return this.data[idx(x, y, z)];
  }

  set(x: number, y: number, z: number, id: number) {
    if (y < 0 || y >= CHUNK_Y) return;
    this.data[idx(x, y, z)] = id;
  }

  recomputeHeight(x: number, z: number) {
    let y = CHUNK_Y - 1;
    while (y > 0 && this.data[idx(x, y, z)] === 0) y--;
    this.heightMap[z * CHUNK_X + x] = y;
  }
}
