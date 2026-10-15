import { B, IS_OPAQUE, LIGHT_EMIT } from './Blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, type Chunk } from './Chunk';
import { PX, PY, PZ } from './ChunkMesher';

/**
 * 体素光照（0..15，Minecraft 式 BFS 洪泛）：
 * - 天空光：逐列自上而下（树叶 -1、水 -2），再 BFS 横向扩散 → 洞穴/屋内变暗
 * - 方块光：荧石/灯笼/海晶灯等光源在 3×3 区块范围内洪泛（暖色，烘焙进顶点）
 */

const NP = PX * PY * PZ;
let queue = new Int32Array(NP * 4);

function bfs(ids: Uint8Array, light: Uint8Array, W: number, H: number, D: number, head: number, tail: number) {
  // 索引布局：(y * D + z) * W + x
  const sY = W * D, sZ = W;
  const Q = queue, QN = Q.length;
  while (head !== tail) {
    const c = Q[head];
    head = (head + 1) % QN;
    const v = light[c] - 1;
    if (v <= 0) continue;
    const x = c % W, z = ((c / W) | 0) % D, y = (c / sY) | 0;
    // 6 邻居
    if (x > 0) { const n = c - 1; if (!IS_OPAQUE[ids[n]] && light[n] < v) { light[n] = v; Q[tail] = n; tail = (tail + 1) % QN; } }
    if (x < W - 1) { const n = c + 1; if (!IS_OPAQUE[ids[n]] && light[n] < v) { light[n] = v; Q[tail] = n; tail = (tail + 1) % QN; } }
    if (z > 0) { const n = c - sZ; if (!IS_OPAQUE[ids[n]] && light[n] < v) { light[n] = v; Q[tail] = n; tail = (tail + 1) % QN; } }
    if (z < D - 1) { const n = c + sZ; if (!IS_OPAQUE[ids[n]] && light[n] < v) { light[n] = v; Q[tail] = n; tail = (tail + 1) % QN; } }
    if (y > 0) { const n = c - sY; if (!IS_OPAQUE[ids[n]] && light[n] < v) { light[n] = v; Q[tail] = n; tail = (tail + 1) % QN; } }
    if (y < H - 1) { const n = c + sY; if (!IS_OPAQUE[ids[n]] && light[n] < v) { light[n] = v; Q[tail] = n; tail = (tail + 1) % QN; } }
  }
}

/** 天空光：输入/输出均为带边距的区块布局（PX×PY×PZ） */
export function computeSkyLight(p: Uint8Array, sky: Uint8Array) {
  sky.fill(0);
  const sY = PX * PZ;
  const Q = queue;
  let tail = 0;
  for (let z = 0; z < PZ; z++)
    for (let x = 0; x < PX; x++) {
      let l = 15;
      for (let y = PY - 1; y >= 0; y--) {
        const i = y * sY + z * PX + x;
        const id = p[i];
        if (IS_OPAQUE[id]) break;
        if (id === B.LEAVES) l = Math.max(0, l - 1);
        else if (id === B.WATER) l = Math.max(0, l - 2);
        if (l <= 0) break;
        sky[i] = l;
      }
    }
  // 只把可能向外扩散的格子入队（有更暗的非不透明邻居）
  for (let y = 1; y < PY - 1; y++)
    for (let z = 0; z < PZ; z++)
      for (let x = 0; x < PX; x++) {
        const i = y * sY + z * PX + x;
        const v = sky[i];
        if (v < 2) continue;
        const t = v - 1;
        if (
          (x > 0 && sky[i - 1] < t && !IS_OPAQUE[p[i - 1]]) ||
          (x < PX - 1 && sky[i + 1] < t && !IS_OPAQUE[p[i + 1]]) ||
          (z > 0 && sky[i - PX] < t && !IS_OPAQUE[p[i - PX]]) ||
          (z < PZ - 1 && sky[i + PX] < t && !IS_OPAQUE[p[i + PX]]) ||
          sky[i - sY] < t && !IS_OPAQUE[p[i - sY]]
        ) {
          Q[tail++] = i;
          if (tail >= Q.length) tail = 0;
        }
      }
  bfs(p, sky, PX, PY, PZ, 0, tail);
}

// 3×3 区块大区域
const BW = CHUNK_X * 3, BD = CHUNK_Z * 3, BH = CHUNK_Y;
const bigIds = new Uint8Array(BW * BD * BH);
const bigLight = new Uint8Array(BW * BD * BH);
if (queue.length < bigIds.length * 2) queue = new Int32Array(bigIds.length * 2);

/** 方块光：nb 为 3×3 邻居（dz 外层、dx 内层，中心为第 4 个），输出带边距布局 */
export function computeBlockLight(nb: (Chunk | undefined)[], out: Uint8Array) {
  bigLight.fill(0);
  const Q = queue, QN = Q.length;
  let tail = 0;
  for (let k = 0; k < 9; k++) {
    const c = nb[k];
    const ox = (k % 3) * CHUNK_X, oz = Math.floor(k / 3) * CHUNK_Z;
    for (let y = 0; y < BH; y++)
      for (let z = 0; z < CHUNK_Z; z++) {
        const src = (y * CHUNK_Z + z) * CHUNK_X;
        const dst = (y * BD + oz + z) * BW + ox;
        if (!c) {
          bigIds.fill(0, dst, dst + CHUNK_X);
          continue;
        }
        for (let x = 0; x < CHUNK_X; x++) {
          const id = c.data[src + x];
          bigIds[dst + x] = id;
          const e = LIGHT_EMIT[id];
          if (e) {
            bigLight[dst + x] = e;
            Q[tail] = dst + x;
            tail = (tail + 1) % QN;
          }
        }
      }
  }
  bfs(bigIds, bigLight, BW, BH, BD, 0, tail);
  // 拷贝到带边距布局：padded x ∈ [0, PX) ↔ big x = x - 1 + CHUNK_X
  out.fill(0);
  for (let py = 1; py < PY - 1; py++) {
    const y = py - 1;
    for (let pz = 0; pz < PZ; pz++) {
      const z = pz - 1 + CHUNK_Z;
      const src = (y * BD + z) * BW + (CHUNK_X - 1);
      const dst = (py * PZ + pz) * PX;
      out.set(bigLight.subarray(src, src + PX), dst);
    }
  }
}
