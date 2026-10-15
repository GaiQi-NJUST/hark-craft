import * as THREE from 'three';
import { BLOCKS, B, IS_OPAQUE, RENDER_KIND } from './Blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z } from './Chunk';
import { LAYER } from './BlockTextures';

/**
 * 区块网格化：合并几何 + 面剔除 + 逐顶点体素 AO（经典 3 邻居算法）+ 各向异性对角线翻转
 * + 平滑体素光照（方块光/天空光，按角点 4 格平均，Minecraft 式）。
 * 输入为带 1 格边距的方块数组（含相邻区块边界），输出三份几何：不透明 / 镂空（树叶、玻璃、植物）/ 水。
 * 热循环零分配：所有面常量预计算为扁平数组，顶点写入可增长的 TypedArray。
 */

export const PX = CHUNK_X + 2;
export const PY = CHUNK_Y + 2;
export const PZ = CHUNK_Z + 2;
export const pidx = (x: number, y: number, z: number) => ((y + 1) * PZ + (z + 1)) * PX + (x + 1);
const DX = 1, DZ = PX, DY = PX * PZ;

const AO_CURVE = [0.42, 0.62, 0.8, 1.0];

// 选取 u×v = n，保证 (−,−)(+,−)(+,+)(−,+) 从外侧看为逆时针
const FACES: { n: number[]; u: number[]; v: number[]; dir: 0 | 1 | 2 }[] = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], dir: 2 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], dir: 2 },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], dir: 0 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], dir: 1 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], dir: 2 },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0], dir: 2 },
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

// 预计算：每面法线邻居偏移、每角点局部坐标、AO 邻居偏移、贴图坐标
const F_NOFF = new Int32Array(6);
const F_NORMAL = new Float32Array(18);
const F_DIR = new Uint8Array(6);
const C_LOCAL = new Float32Array(6 * 4 * 3);
const C_AO = new Int32Array(6 * 4 * 3);
const C_TEX = new Float32Array(6 * 4 * 2);
FACES.forEach((f, fi) => {
  const [nx, ny, nz] = f.n;
  F_NOFF[fi] = nx * DX + ny * DY + nz * DZ;
  F_NORMAL.set(f.n, fi * 3);
  F_DIR[fi] = f.dir;
  CORNERS.forEach(([su, sv], c) => {
    const ux = f.u[0] * su, uy = f.u[1] * su, uz = f.u[2] * su;
    const vx = f.v[0] * sv, vy = f.v[1] * sv, vz = f.v[2] * sv;
    const lx = (1 + nx + ux + vx) / 2, ly = (1 + ny + uy + vy) / 2, lz = (1 + nz + uz + vz) / 2;
    const o = (fi * 4 + c) * 3;
    C_LOCAL[o] = lx; C_LOCAL[o + 1] = ly; C_LOCAL[o + 2] = lz;
    C_AO[o] = ux * DX + uy * DY + uz * DZ;
    C_AO[o + 1] = vx * DX + vy * DY + vz * DZ;
    C_AO[o + 2] = C_AO[o] + C_AO[o + 1];
    let tu: number, tv: number;
    if (nx !== 0) { tu = nx > 0 ? 1 - lz : lz; tv = ly; }
    else if (nz !== 0) { tu = nz > 0 ? lx : 1 - lx; tv = ly; }
    else { tu = lx; tv = ny > 0 ? 1 - lz : lz; }
    C_TEX[(fi * 4 + c) * 2] = tu;
    C_TEX[(fi * 4 + c) * 2 + 1] = tv;
  });
});

class GeoBuilder {
  cap = 0;
  count = 0;
  icount = 0;
  pos = new Float32Array(0);
  nor = new Float32Array(0);
  tex = new Float32Array(0);
  light = new Float32Array(0);
  col = new Float32Array(0);
  extra = new Float32Array(0);
  index = new Uint32Array(0);

  reset() {
    this.count = 0;
    this.icount = 0;
  }

  ensure(n: number) {
    if (this.count + n <= this.cap) return;
    let cap = Math.max(4096, this.cap * 2);
    while (cap < this.count + n) cap *= 2;
    const grow = <T extends Float32Array | Uint32Array>(a: T, k: number): T => {
      const b = new (a.constructor as { new (n: number): T })(cap * k);
      b.set(a);
      return b;
    };
    this.pos = grow(this.pos, 3);
    this.nor = grow(this.nor, 3);
    this.tex = grow(this.tex, 3);
    this.light = grow(this.light, 2);
    this.col = grow(this.col, 3);
    this.extra = grow(this.extra, 1);
    this.index = grow(this.index, 1.5);
    this.cap = cap;
  }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, layer: number, c: number, e: number, bl: number, sl: number) {
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.nor[i * 3] = nx; this.nor[i * 3 + 1] = ny; this.nor[i * 3 + 2] = nz;
    this.tex[i * 3] = u; this.tex[i * 3 + 1] = v; this.tex[i * 3 + 2] = layer;
    this.light[i * 2] = bl; this.light[i * 2 + 1] = sl;
    this.col[i * 3] = c; this.col[i * 3 + 1] = c; this.col[i * 3 + 2] = c;
    this.extra[i] = e;
  }

  quad(base: number, flip: boolean) {
    const ix = this.index;
    let k = this.icount;
    if (flip) {
      ix[k++] = base + 1; ix[k++] = base + 2; ix[k++] = base + 3;
      ix[k++] = base + 1; ix[k++] = base + 3; ix[k++] = base;
    } else {
      ix[k++] = base; ix[k++] = base + 1; ix[k++] = base + 2;
      ix[k++] = base; ix[k++] = base + 2; ix[k++] = base + 3;
    }
    this.icount = k;
  }

  build(extraName: string): THREE.BufferGeometry | null {
    if (this.count === 0) return null;
    const n = this.count;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, n * 3), 3));
    g.setAttribute('aTex', new THREE.BufferAttribute(this.tex.slice(0, n * 3), 3));
    g.setAttribute('aLight', new THREE.BufferAttribute(this.light.slice(0, n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n * 3), 3));
    g.setAttribute(extraName, new THREE.BufferAttribute(this.extra.slice(0, n), 1));
    const idx = n > 65535 ? this.index.slice(0, this.icount) : Uint16Array.from(this.index.subarray(0, this.icount));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export interface MeshResult {
  opaque: THREE.BufferGeometry | null;
  cutout: THREE.BufferGeometry | null;
  water: THREE.BufferGeometry | null;
}

// 复用的构建器
const builders = { opaque: new GeoBuilder(), cutout: new GeoBuilder(), water: new GeoBuilder() };
const LAYERTAB = new Float32Array(256 * 3); // [id*3+dir] → 纹理数组层
const EMISSIVE = new Float32Array(256);
const SWAY = new Float32Array(256);
for (const d of BLOCKS) {
  if (!d) continue;
  (['top', 'bottom', 'side'] as const).forEach((dir, di) => {
    LAYERTAB[d.id * 3 + di] = LAYER[d.tiles[dir]];
  });
  EMISSIVE[d.id] = d.emissive;
  SWAY[d.id] = d.sway;
}
const INV15 = 1 / 15;

const CROSS = [
  [0.15, 0.15, 0.85, 0.85],
  [0.15, 0.85, 0.85, 0.15],
];

/** p：带 1 格边距的方块；blk/sky：同布局的方块光/天空光（0..15） */
export function meshChunk(p: Uint8Array, blk: Uint8Array, sky: Uint8Array): MeshResult {
  const opaque = builders.opaque, cutout = builders.cutout, water = builders.water;
  opaque.reset(); cutout.reset(); water.reset();
  const ao = [0, 0, 0, 0];

  for (let y = 0; y < CHUNK_Y; y++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      let i = ((y + 1) * PZ + (z + 1)) * PX + 1;
      for (let x = 0; x < CHUNK_X; x++, i++) {
        const id = p[i];
        if (id === B.AIR) continue;
        const kind = RENDER_KIND[id];

        if (kind === 3) {
          // 十字植物（两片对角面片，顶点上沿随风摆动）
          const layer = LAYERTAB[id * 3 + 2];
          const sw = SWAY[id];
          const bl = blk[i] * INV15, sl = sky[i] * INV15;
          cutout.ensure(8);
          for (const [ax, az, bx, bz] of CROSS) {
            const base = cutout.count;
            cutout.vert(x + ax, y, z + az, 0, 1, 0, 0, 0, layer, 1, 0, bl, sl);
            cutout.vert(x + bx, y, z + bz, 0, 1, 0, 1, 0, layer, 1, 0, bl, sl);
            cutout.vert(x + bx, y + 0.9, z + bz, 0, 1, 0, 1, 1, layer, 1, sw, bl, sl);
            cutout.vert(x + ax, y + 0.9, z + az, 0, 1, 0, 0, 1, layer, 1, sw, bl, sl);
            cutout.quad(base, false);
          }
          continue;
        }

        const b = kind === 1 ? opaque : kind === 2 ? cutout : water;
        const waterTopLower = kind === 4 && p[i + DY] !== B.WATER;
        const extraBase = kind === 1 ? EMISSIVE[id] : kind === 2 ? SWAY[id] : 0;

        for (let f = 0; f < 6; f++) {
          const ni = i + F_NOFF[f];
          const nid = p[ni];
          if (f === 3 && y === 0) continue; // 世界底部
          if (kind === 1) {
            if (IS_OPAQUE[nid]) continue;
          } else if (kind === 2) {
            if (IS_OPAQUE[nid] || nid === id) continue;
          } else {
            if (IS_OPAQUE[nid] || nid === B.WATER) continue;
            if (f === 3 && nid !== B.AIR) continue;
          }

          const layer = LAYERTAB[id * 3 + F_DIR[f]];
          const nx = F_NORMAL[f * 3], ny = F_NORMAL[f * 3 + 1], nz = F_NORMAL[f * 3 + 2];
          b.ensure(4);
          const base = b.count;
          for (let c = 0; c < 4; c++) {
            const co = (f * 4 + c) * 3;
            let a = 3;
            let bsum = blk[ni], ssum = sky[ni], ln = 1;
            if (kind !== 4) {
              const o1 = ni + C_AO[co], o2 = ni + C_AO[co + 1], o3 = ni + C_AO[co + 2];
              const s1 = IS_OPAQUE[p[o1]];
              const s2 = IS_OPAQUE[p[o2]];
              const cc = IS_OPAQUE[p[o3]];
              a = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
              if (!s1) { bsum += blk[o1]; ssum += sky[o1]; ln++; }
              if (!s2) { bsum += blk[o2]; ssum += sky[o2]; ln++; }
              if (!cc && !(s1 && s2)) { bsum += blk[o3]; ssum += sky[o3]; ln++; }
            }
            ao[c] = a;
            let ly = C_LOCAL[co + 1];
            if (waterTopLower && ly > 0.5) ly = 0.875;
            const to = (f * 4 + c) * 2;
            const extra = kind === 4 ? (ly > 0.5 && ny >= 0 ? 1 : 0) : extraBase;
            b.vert(
              x + C_LOCAL[co], y + ly, z + C_LOCAL[co + 2],
              nx, ny, nz,
              C_TEX[to], C_TEX[to + 1], layer,
              AO_CURVE[a], extra, bsum * INV15 / ln, ssum * INV15 / ln,
            );
          }
          // 各向异性修正：AO 不对称时翻转对角线
          b.quad(base, ao[0] + ao[2] < ao[1] + ao[3]);
        }
      }
    }
  }

  return {
    opaque: opaque.build('aEmissive'),
    cutout: cutout.build('aSway'),
    water: water.build('aSurface'),
  };
}
