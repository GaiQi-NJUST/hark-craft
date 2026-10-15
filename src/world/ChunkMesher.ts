import * as THREE from 'three';
import { BLOCKS, B, IS_OPAQUE, RENDER_KIND } from './Blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z } from './Chunk';
import type { TextureAtlas } from './TextureAtlas';

/**
 * 区块网格化：合并几何 + 面剔除 + 逐顶点体素 AO（经典 3 邻居算法）+ 各向异性对角线翻转。
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
  uv = new Float32Array(0);
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
    this.uv = grow(this.uv, 2);
    this.col = grow(this.col, 3);
    this.extra = grow(this.extra, 1);
    this.index = grow(this.index, 1.5);
    this.cap = cap;
  }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: number, e: number) {
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.nor[i * 3] = nx; this.nor[i * 3 + 1] = ny; this.nor[i * 3 + 2] = nz;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
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
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2));
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
let UVTABLE: Float32Array | null = null; // [id*3+dir]*4 → u0 v0 u1 v1
const EMISSIVE = new Float32Array(256);
const SWAY = new Float32Array(256);

function uvTable(atlas: TextureAtlas) {
  if (UVTABLE) return UVTABLE;
  UVTABLE = new Float32Array(256 * 3 * 4);
  for (const d of BLOCKS) {
    if (!d) continue;
    (['top', 'bottom', 'side'] as const).forEach((dir, di) => {
      const r = atlas.uv(d.tiles[dir]);
      UVTABLE!.set([r.u0, r.v0, r.u1, r.v1], (d.id * 3 + di) * 4);
    });
    EMISSIVE[d.id] = d.emissive;
    SWAY[d.id] = d.sway;
  }
  return UVTABLE;
}

const CROSS = [
  [0.15, 0.15, 0.85, 0.85],
  [0.15, 0.85, 0.85, 0.15],
];

export function meshChunk(p: Uint8Array, atlas: TextureAtlas): MeshResult {
  const UV = uvTable(atlas);
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
          const o = (id * 3 + 2) * 4;
          const u0 = UV[o], v0 = UV[o + 1], u1 = UV[o + 2], v1 = UV[o + 3];
          const sw = SWAY[id];
          cutout.ensure(8);
          for (const [ax, az, bx, bz] of CROSS) {
            const base = cutout.count;
            cutout.vert(x + ax, y, z + az, 0, 1, 0, u0, v0, 1, 0);
            cutout.vert(x + bx, y, z + bz, 0, 1, 0, u1, v0, 1, 0);
            cutout.vert(x + bx, y + 0.9, z + bz, 0, 1, 0, u1, v1, 1, sw);
            cutout.vert(x + ax, y + 0.9, z + az, 0, 1, 0, u0, v1, 1, sw);
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

          const o = (id * 3 + F_DIR[f]) * 4;
          const u0 = UV[o], v0 = UV[o + 1], du = UV[o + 2] - u0, dv = UV[o + 3] - v0;
          const nx = F_NORMAL[f * 3], ny = F_NORMAL[f * 3 + 1], nz = F_NORMAL[f * 3 + 2];
          b.ensure(4);
          const base = b.count;
          for (let c = 0; c < 4; c++) {
            const co = (f * 4 + c) * 3;
            let a = 3;
            if (kind !== 4) {
              const s1 = IS_OPAQUE[p[ni + C_AO[co]]];
              const s2 = IS_OPAQUE[p[ni + C_AO[co + 1]]];
              const cc = IS_OPAQUE[p[ni + C_AO[co + 2]]];
              a = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            }
            ao[c] = a;
            let ly = C_LOCAL[co + 1];
            if (waterTopLower && ly > 0.5) ly = 0.875;
            const to = (f * 4 + c) * 2;
            const extra = kind === 4 ? (ly > 0.5 && ny >= 0 ? 1 : 0) : extraBase;
            b.vert(
              x + C_LOCAL[co], y + ly, z + C_LOCAL[co + 2],
              nx, ny, nz,
              u0 + du * C_TEX[to], v0 + dv * C_TEX[to + 1],
              AO_CURVE[a], extra,
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
