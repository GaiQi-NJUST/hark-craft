import * as THREE from 'three';
import { TILE_NAMES, type TileName } from './texgen/painters';
import { generateTile, downsample, type TileData } from './texgen/generate';
import { BLOCKS } from './Blocks';

/**
 * 「材质包」：启动时程序化生成全部方块的 PBR 贴图，打包为三张 DataArrayTexture
 * （反照率 sRGB / 法线+缝隙AO / 金属-粗糙-自发光-湿润），每层独立 mipmap，无图集串色。
 * - 先同步生成 64x 基础版（图标、像素 16x、64x 直接用），
 * - 再按设置分帧渐进生成 128x / 256x，完成后热替换（不阻塞主线程）。
 */

export type TexRes = 16 | 64 | 128 | 256;
export const TEX_LABEL: Record<TexRes, string> = { 16: '像素 16x', 64: '高清 64x', 128: '高清 128x', 256: '高清 256x' };

export const LAYER: Record<TileName, number> = Object.fromEntries(TILE_NAMES.map((n, i) => [n, i])) as Record<TileName, number>;
export const LAYER_COUNT = TILE_NAMES.length;

export interface BlockTexSet {
  res: TexRes;
  albedo: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  mer: THREE.DataArrayTexture;
  pbr: boolean;
}

function packArray(tiles: TileData[], key: 'albedo' | 'normal' | 'mer', S: number): Uint8Array<ArrayBuffer> {
  const L = tiles.length;
  const out = new Uint8Array(S * S * 4 * L);
  const row = S * 4;
  for (let l = 0; l < L; l++) {
    const src = tiles[l][key];
    const base = l * S * S * 4;
    // DataArrayTexture 不支持 flipY：图像第 0 行（顶部）写到 v=1
    for (let y = 0; y < S; y++) out.set(src.subarray(y * row, (y + 1) * row), base + (S - 1 - y) * row);
  }
  return out;
}

export class BlockTextures {
  base: TileData[] = [];
  current: BlockTexSet | null = null;
  private job: { res: TexRes; tiles: TileData[]; next: number } | null = null;
  private anisotropy = 4;
  private iconCache = new Map<string, string>();
  /** 每次贴图集替换 +1（UI 据此刷新图标） */
  version = 0;
  onChange: ((set: BlockTexSet) => void) | null = null;

  constructor() {
    for (const n of TILE_NAMES) this.base.push(generateTile(n, 64));
  }

  setAnisotropy(a: number) {
    this.anisotropy = a;
  }

  get pendingRes(): TexRes | null {
    return this.job ? this.job.res : null;
  }

  /** 请求切换分辨率：≤64 立即完成，否则排入渐进任务 */
  request(res: TexRes) {
    if (this.current?.res === res && !this.job) return;
    if (res <= 64) {
      this.job = null;
      const tiles = res === 64 ? this.base : this.base.map((t) => downsample(t, 16));
      this.install(res, tiles);
      return;
    }
    if (this.job?.res === res) return;
    this.job = { res, tiles: [], next: 0 };
  }

  /** 每帧调用：在预算内推进渐进生成；返回是否仍有任务 */
  step(budgetMs: number): boolean {
    const j = this.job;
    if (!j) return false;
    const t0 = performance.now();
    do {
      j.tiles.push(generateTile(TILE_NAMES[j.next], j.res));
      j.next++;
    } while (j.next < LAYER_COUNT && performance.now() - t0 < budgetMs);
    if (j.next >= LAYER_COUNT) {
      this.job = null;
      this.install(j.res, j.tiles);
      return false;
    }
    return true;
  }

  /** 同步完成当前任务（无头测试 / 立即需要时） */
  finish() {
    while (this.step(1000)) {
      /* noop */
    }
  }

  get progress(): number {
    return this.job ? this.job.next / LAYER_COUNT : 1;
  }

  private install(res: TexRes, tiles: TileData[]) {
    const S = tiles[0].size;
    const pixel = res === 16;
    const make = (key: 'albedo' | 'normal' | 'mer') => {
      const tex = new THREE.DataArrayTexture(packArray(tiles, key, S), S, S, tiles.length);
      tex.format = THREE.RGBAFormat;
      tex.type = THREE.UnsignedByteType;
      tex.generateMipmaps = true;
      tex.magFilter = pixel ? THREE.NearestFilter : THREE.LinearFilter;
      tex.minFilter = pixel ? THREE.NearestMipmapLinearFilter : THREE.LinearMipmapLinearFilter;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = this.anisotropy;
      tex.colorSpace = key === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.needsUpdate = true;
      return tex;
    };
    const old = this.current;
    this.current = { res, albedo: make('albedo'), normal: make('normal'), mer: make('mer'), pbr: !pixel };
    this.version++;
    this.onChange?.(this.current);
    if (old) {
      // 延迟释放，确保新纹理已在下一帧上传
      setTimeout(() => {
        old.albedo.dispose();
        old.normal.dispose();
        old.mer.dispose();
      }, 500);
    }
  }

  /** 单个贴图的 canvas（来自 64x 基础版；pixel=true 时 16x） */
  tileCanvas(name: TileName, pixel = false): HTMLCanvasElement {
    const t0 = this.base[LAYER[name]];
    const t = pixel ? downsample(t0, 16) : t0;
    const c = document.createElement('canvas');
    c.width = c.height = t.size;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(t.size, t.size);
    img.data.set(t.albedo);
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** 物品图标（等距方块；植物为平面贴图），返回 dataURL */
  icon(blockId: number, size = 64, pixel = false): string {
    const key = `${blockId}:${size}:${pixel ? 1 : 0}`;
    const cached = this.iconCache.get(key);
    if (cached) return cached;
    const def = BLOCKS[blockId];
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = !pixel;
    ctx.imageSmoothingQuality = 'high';
    if (def.render === 'cross') {
      ctx.drawImage(this.tileCanvas(def.tiles.side, pixel), size * 0.08, size * 0.08, size * 0.84, size * 0.84);
    } else {
      const T = pixel ? 16 : 64;
      const k = 1 / T;
      const face = (tile: TileName, shade: number) => {
        const tmp = this.tileCanvas(tile, pixel);
        const tc = tmp.getContext('2d')!;
        if (shade > 0) {
          tc.globalCompositeOperation = 'source-atop';
          tc.fillStyle = `rgba(0,0,0,${shade})`;
          tc.fillRect(0, 0, T, T);
        }
        return tmp;
      };
      const pad = size * 0.06;
      const S = size - pad * 2;
      ctx.setTransform((S / 2) * k, (-S / 4) * k, (S / 2) * k, (S / 4) * k, pad, pad + S / 4);
      ctx.drawImage(face(def.tiles.top, 0), 0, 0);
      ctx.setTransform((S / 2) * k, (S / 4) * k, 0, (S / 2) * k, pad, pad + S / 4);
      ctx.drawImage(face(def.tiles.side, 0.22), 0, 0);
      ctx.setTransform((S / 2) * k, (-S / 4) * k, 0, (S / 2) * k, pad + S / 2, pad + S / 2);
      ctx.drawImage(face(def.tiles.side, 0.42), 0, 0);
    }
    const url = c.toDataURL();
    this.iconCache.set(key, url);
    return url;
  }
}

let shared: BlockTextures | null = null;
export function getBlockTextures(): BlockTextures {
  if (!shared) shared = new BlockTextures();
  return shared;
}
