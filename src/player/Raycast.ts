import type * as THREE from 'three';
import { B } from '../world/Blocks';

export interface RayHit {
  x: number;
  y: number;
  z: number;
  /** 命中面的法线（放置方块的方向） */
  nx: number;
  ny: number;
  nz: number;
  id: number;
  dist: number;
}

/**
 * Amanatides & Woo 体素 DDA 射线遍历。
 * 跳过空气与水，可命中植物。
 */
export function raycastVoxel(
  getBlock: (x: number, y: number, z: number) => number,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
): RayHit | null {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = Math.abs(1 / (dir.x || 1e-9));
  const tDeltaY = Math.abs(1 / (dir.y || 1e-9));
  const tDeltaZ = Math.abs(1 / (dir.z || 1e-9));
  const frac = (v: number, s: number) => (s > 0 ? Math.floor(v) + 1 - v : v - Math.floor(v));
  let tMaxX = tDeltaX * frac(origin.x, stepX);
  let tMaxY = tDeltaY * frac(origin.y, stepY);
  let tMaxZ = tDeltaZ * frac(origin.z, stepZ);
  let nx = 0, ny = 0, nz = 0;
  let t = 0;
  for (let i = 0; i < 256 && t <= maxDist; i++) {
    const id = getBlock(x, y, z);
    if (id !== B.AIR && id !== B.WATER) return { x, y, z, nx, ny, nz, id, dist: t };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}
