import * as THREE from 'three';
import { B, IS_OPAQUE, IS_SOLID, LIGHT_EMIT } from './Blocks';
import { Chunk, chunkKey, CHUNK_X, CHUNK_Y, CHUNK_Z, idx } from './Chunk';
import { meshChunk, PX, PY, PZ } from './ChunkMesher';
import { TerrainGen, SEA_LEVEL } from './TerrainGen';
import { createBlockMaterial, createCutoutDepthMaterial, setPCSS } from './BlockMaterial';
import { createWaterMaterial, type WaterMaterial } from '../fx/Water';
import { computeSkyLight, computeBlockLight } from './Light';

/**
 * 区块管理器：按距离排序的增量生成（每帧时间预算）、卸载远处区块、
 * 编辑后只重建所在区块（以及边界处的相邻区块）。
 */
export class World {
  readonly group = new THREE.Group();
  readonly materials: {
    opaque: THREE.MeshStandardMaterial;
    cutout: THREE.MeshStandardMaterial;
    cutoutDepth: THREE.MeshDepthMaterial;
    water: WaterMaterial;
  };
  gen: TerrainGen;
  renderDistance = 6;

  private chunks = new Map<string, Chunk>();
  private edits = new Map<string, Map<number, number>>();
  private priority = new Set<string>();
  private order: [number, number, number][] = [];
  private centerKey = '';
  private padded = new Uint8Array(PX * PY * PZ);
  private blkP = new Uint8Array(PX * PY * PZ);
  private skyP = new Uint8Array(PX * PY * PZ);
  private lastChunk: Chunk | null = null;
  meshedCount = 0;
  /** 只有阴影范围内的区块投射阴影（阴影 pass 绘制调用预算） */
  private shadowR = 3.2;
  private scx = 0;
  private scz = 0;

  constructor(seed: number) {
    this.gen = new TerrainGen(seed);
    this.materials = {
      opaque: createBlockMaterial('opaque', false),
      cutout: createBlockMaterial('cutout', false),
      cutoutDepth: createCutoutDepthMaterial(),
      water: createWaterMaterial(),
    };
    this.group.name = 'world';
  }

  /** 高画质：PCSS 软阴影 */
  setPCSS(on: boolean) {
    setPCSS(this.materials.opaque, on);
    setPCSS(this.materials.cutout, on);
  }

  get chunkCount() {
    return this.chunks.size;
  }

  /** 重新生成世界（新种子），清空编辑记录 */
  reset(seed: number) {
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    this.edits.clear();
    this.priority.clear();
    this.centerKey = '';
    this.lastChunk = null;
    this.meshedCount = 0;
    this.gen = new TerrainGen(seed);
  }

  setShadowRadius(blocks: number) {
    this.shadowR = blocks / CHUNK_X + 0.3;
    this.refreshShadowCasters();
  }

  private castsShadow(c: Chunk) {
    return Math.hypot(c.cx - this.scx, c.cz - this.scz) <= this.shadowR;
  }

  private refreshShadowCasters() {
    for (const c of this.chunks.values()) {
      const on = this.castsShadow(c);
      if (c.meshes.opaque) c.meshes.opaque.castShadow = on;
      if (c.meshes.cutout) c.meshes.cutout.castShadow = on;
    }
  }

  setRenderDistance(r: number) {
    if (r === this.renderDistance) return;
    this.renderDistance = r;
    this.centerKey = '';
  }

  private getChunk(cx: number, cz: number): Chunk | undefined {
    const l = this.lastChunk;
    if (l && l.cx === cx && l.cz === cz) return l;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c) this.lastChunk = c;
    return c;
  }

  getBlock(wx: number, wy: number, wz: number): number {
    if (wy < 0) return B.BEDROCK;
    if (wy >= CHUNK_Y) return B.AIR;
    const cx = Math.floor(wx / CHUNK_X), cz = Math.floor(wz / CHUNK_Z);
    const c = this.getChunk(cx, cz);
    if (!c || !c.generated) return B.AIR;
    return c.data[idx(wx - cx * CHUNK_X, wy, wz - cz * CHUNK_Z)];
  }

  isSolid(wx: number, wy: number, wz: number) {
    return IS_SOLID[this.getBlock(wx, wy, wz)] === 1;
  }

  isLoaded(wx: number, wz: number): boolean {
    const c = this.getChunk(Math.floor(wx / CHUNK_X), Math.floor(wz / CHUNK_Z));
    return !!c && c.generated;
  }

  isMeshed(wx: number, wz: number): boolean {
    const c = this.getChunk(Math.floor(wx / CHUNK_X), Math.floor(wz / CHUNK_Z));
    return !!c && c.generated && !c.dirty;
  }

  /** 列顶部最高的实体方块 y（不含植物、水），未加载时返回地形函数估计 */
  surfaceHeight(wx: number, wz: number): number {
    const fx = Math.floor(wx), fz = Math.floor(wz);
    if (!this.isLoaded(fx, fz)) return this.gen.column(fx, fz).h;
    for (let y = CHUNK_Y - 1; y > 0; y--) {
      const id = this.getBlock(fx, y, fz);
      if (IS_SOLID[id] || id === B.WATER) return y;
    }
    return 0;
  }

  /** 寻找出生点：从原点螺旋搜索陆地 */
  findSpawn(): THREE.Vector3 {
    for (let r = 0; r < 200; r += 3) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r);
        const col = this.gen.column(x, z);
        if (col.h > SEA_LEVEL + 1 && col.h < 34) return new THREE.Vector3(x + 0.5, col.h + 1, z + 0.5);
        if (r === 0) break;
      }
    }
    return new THREE.Vector3(0.5, 40, 0.5);
  }

  /** 在已加载区块中，从 (x,z) 附近找一个地表不是树叶/原木/水的落脚点 */
  findSafeSpot(x: number, z: number): THREE.Vector3 {
    for (let r = 0; r <= 12; r++) {
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const fx = Math.floor(x) + dx, fz = Math.floor(z) + dz;
          if (!this.isLoaded(fx, fz)) continue;
          const y = this.surfaceHeight(fx, fz);
          const top = this.getBlock(fx, y, fz);
          if (top === B.LEAVES || top === B.LOG || top === B.WATER) continue;
          if (this.isSolid(fx, y + 1, fz) || this.isSolid(fx, y + 2, fz)) continue;
          return new THREE.Vector3(fx + 0.5, y + 1, fz + 0.5);
        }
    }
    return new THREE.Vector3(Math.floor(x) + 0.5, this.surfaceHeight(x, z) + 1, Math.floor(z) + 0.5);
  }

  setBlock(wx: number, wy: number, wz: number, id: number): boolean {
    if (wy < 1 || wy >= CHUNK_Y) return false;
    const cx = Math.floor(wx / CHUNK_X), cz = Math.floor(wz / CHUNK_Z);
    const c = this.getChunk(cx, cz);
    if (!c || !c.generated) return false;
    const lx = wx - cx * CHUNK_X, lz = wz - cz * CHUNK_Z;
    const i = idx(lx, wy, lz);
    const old = c.data[i];
    if (old === id) return false;
    c.data[i] = id;
    c.lightCount += (LIGHT_EMIT[id] ? 1 : 0) - (LIGHT_EMIT[old] ? 1 : 0);
    c.recomputeHeight(lx, lz);
    let e = this.edits.get(c.key);
    if (!e) this.edits.set(c.key, (e = new Map()));
    e.set(i, id);

    const mark = (x: number, z: number) => {
      const n = this.getChunk(x, z);
      if (n && n.generated) {
        n.dirty = true;
        this.priority.add(n.key);
      }
    };
    mark(cx, cz);
    const bx = lx === 0 ? -1 : lx === CHUNK_X - 1 ? 1 : 0;
    const bz = lz === 0 ? -1 : lz === CHUNK_Z - 1 ? 1 : 0;
    if (bx) mark(cx + bx, cz);
    if (bz) mark(cx, cz + bz);
    if (bx && bz) mark(cx + bx, cz + bz);
    if (LIGHT_EMIT[old] || LIGHT_EMIT[id]) {
      // 光源变化：光照最多传播 14 格，重建周围 3×3 区块
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) mark(cx + dx, cz + dz);
    }
    return true;
  }

  private rebuildOrder(ccx: number, ccz: number) {
    // 数据半径 = 渲染半径 + 2（保证最外圈网格化所需的对角邻居也已生成）
    const R = this.renderDistance + 2;
    const list: [number, number, number][] = [];
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d <= R) list.push([ccx + dx, ccz + dz, d]);
      }
    list.sort((a, b) => a[2] - b[2]);
    this.order = list;

    // 卸载远处区块（保留编辑记录）
    const limit = this.renderDistance + 3;
    for (const c of [...this.chunks.values()]) {
      if (Math.max(Math.abs(c.cx - ccx), Math.abs(c.cz - ccz)) > limit) {
        this.disposeChunk(c);
        this.chunks.delete(c.key);
        if (this.lastChunk === c) this.lastChunk = null;
      }
    }
  }

  private neighborsReady(cx: number, cz: number) {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk(cx + dx, cz + dz);
        if (!n || !n.generated) return false;
      }
    return true;
  }

  private generateChunk(cx: number, cz: number) {
    const c = new Chunk(cx, cz);
    this.gen.generate(c);
    const e = this.edits.get(c.key);
    if (e) {
      for (const [i, id] of e) c.data[i] = id;
      for (let z = 0; z < CHUNK_Z; z++) for (let x = 0; x < CHUNK_X; x++) c.recomputeHeight(x, z);
    }
    let lc = 0;
    const d = c.data;
    for (let k = 0; k < d.length; k++) if (LIGHT_EMIT[d[k]]) lc++;
    c.lightCount = lc;
    this.chunks.set(c.key, c);
  }

  /** 每帧调用：在 budgetMs 内推进生成/网格化 */
  update(focus: THREE.Vector3, budgetMs: number) {
    const ccx = Math.floor(focus.x / CHUNK_X), ccz = Math.floor(focus.z / CHUNK_Z);
    const key = `${ccx},${ccz},${this.renderDistance}`;
    if (key !== this.centerKey) {
      this.centerKey = key;
      this.rebuildOrder(ccx, ccz);
      this.scx = ccx;
      this.scz = ccz;
      this.refreshShadowCasters();
    }

    // 编辑过的区块立即重建（不受预算限制）
    if (this.priority.size) {
      for (const k of this.priority) {
        const c = this.chunks.get(k);
        if (c && this.neighborsReady(c.cx, c.cz)) this.buildMesh(c);
      }
      this.priority.clear();
    }

    const t0 = performance.now();
    const R = this.renderDistance;
    for (const [cx, cz, d] of this.order) {
      if (performance.now() - t0 > budgetMs) break;
      const k = chunkKey(cx, cz);
      let c = this.chunks.get(k);
      if (!c) {
        this.generateChunk(cx, cz);
        continue;
      }
      if (d <= R + 0.5 && c.dirty && this.neighborsReady(cx, cz)) {
        // 确保邻居已生成；邻居可能在同一帧内刚刚生成
        this.buildMesh(c);
      }
    }
  }

  /** 是否所有渲染距离内区块都已网格化 */
  isComplete(): boolean {
    const R = this.renderDistance;
    for (const [cx, cz, d] of this.order) {
      if (d > R + 0.5) continue;
      const c = this.chunks.get(chunkKey(cx, cz));
      if (!c || c.dirty) return false;
    }
    return this.order.length > 0;
  }

  /** 加载进度（0..1），用于过场 */
  progress(): number {
    const R = this.renderDistance;
    let total = 0, done = 0;
    for (const [cx, cz, d] of this.order) {
      if (d > R + 0.5) continue;
      total++;
      const c = this.chunks.get(chunkKey(cx, cz));
      if (c && !c.dirty) done++;
    }
    return total ? done / total : 0;
  }

  private fillPadded(c: Chunk) {
    const p = this.padded;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk(c.cx + dx, c.cz + dz)!;
        const x0 = dx < 0 ? CHUNK_X - 1 : 0, x1 = dx < 0 ? CHUNK_X : dx > 0 ? 1 : CHUNK_X;
        const z0 = dz < 0 ? CHUNK_Z - 1 : 0, z1 = dz < 0 ? CHUNK_Z : dz > 0 ? 1 : CHUNK_Z;
        const offX = dx * CHUNK_X, offZ = dz * CHUNK_Z;
        for (let y = 0; y < CHUNK_Y; y++)
          for (let z = z0; z < z1; z++) {
            const pz = z + offZ + 1;
            if (pz < 0 || pz >= PZ) continue;
            const src = (y * CHUNK_Z + z) * CHUNK_X;
            const dst = ((y + 1) * PZ + pz) * PX;
            for (let x = x0; x < x1; x++) {
              const pxi = x + offX + 1;
              if (pxi < 0 || pxi >= PX) continue;
              p[dst + pxi] = n.data[src + x];
            }
          }
      }
    // 底部视为基岩，顶部为空气
    const layer = PX * PZ;
    p.fill(B.BEDROCK, 0, layer);
    p.fill(B.AIR, (PY - 1) * layer, PY * layer);
  }

  private buildMesh(c: Chunk) {
    this.fillPadded(c);
    computeSkyLight(this.padded, this.skyP);
    const nb: (Chunk | undefined)[] = [];
    let anyLight = false;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk(c.cx + dx, c.cz + dz);
        nb.push(n);
        if (n && n.lightCount > 0) anyLight = true;
      }
    if (anyLight) computeBlockLight(nb, this.blkP);
    else this.blkP.fill(0);
    const res = meshChunk(this.padded, this.blkP, this.skyP);
    const wasMeshed = !c.dirty || Object.keys(c.meshes).length > 0;
    this.disposeMeshes(c);
    const ox = c.cx * CHUNK_X, oz = c.cz * CHUNK_Z;
    if (res.opaque) {
      const m = new THREE.Mesh(res.opaque, this.materials.opaque);
      m.receiveShadow = true;
      m.castShadow = this.castsShadow(c);
      m.position.set(ox, 0, oz);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.group.add(m);
      c.meshes.opaque = m;
    }
    if (res.cutout) {
      const m = new THREE.Mesh(res.cutout, this.materials.cutout);
      m.receiveShadow = true;
      m.castShadow = this.castsShadow(c);
      m.customDepthMaterial = this.materials.cutoutDepth;
      m.position.set(ox, 0, oz);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.group.add(m);
      c.meshes.cutout = m;
    }
    if (res.water) {
      const m = new THREE.Mesh(res.water, this.materials.water);
      m.receiveShadow = false;
      m.renderOrder = 2;
      m.position.set(ox, 0, oz);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.group.add(m);
      c.meshes.water = m;
    }
    if (!wasMeshed) this.meshedCount++;
    c.dirty = false;
  }

  private disposeMeshes(c: Chunk) {
    for (const m of Object.values(c.meshes)) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    c.meshes = {};
  }

  private disposeChunk(c: Chunk) {
    this.disposeMeshes(c);
  }

  /** 是否被不透明方块遮挡（用于粒子/相机判断） */
  isOpaque(wx: number, wy: number, wz: number) {
    return IS_OPAQUE[this.getBlock(wx, wy, wz)] === 1;
  }
}
