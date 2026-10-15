import * as THREE from 'three';
/** 旧版 16x 手绘像素贴图（仅用于开场动画与 Logo；游戏世界使用 BlockTextures 的 PBR 纹理数组） */
type TileName =
  | 'grass_top' | 'grass_side' | 'dirt' | 'stone' | 'sand' | 'log_side' | 'log_top'
  | 'planks' | 'glass' | 'glowstone' | 'snow' | 'leaves' | 'water' | 'flower_red'
  | 'flower_yellow' | 'tall_grass' | 'bedrock' | 'gold' | 'gravel';

/**
 * 程序化 16x16 像素风贴图图集（Canvas 生成，无外部图片）。
 * 所有贴图使用种子随机数，保证每次生成一致。
 */

const TILE = 16;
const COLS = 8;
const ROWS = 4;

export const TILE_ORDER: TileName[] = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'sand', 'log_side', 'log_top', 'planks',
  'glass', 'glowstone', 'snow', 'leaves', 'water', 'flower_red', 'flower_yellow', 'tall_grass',
  'bedrock', 'gold', 'gravel',
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Px = (x: number, y: number, color: string | null) => void;

function hexA(hex: string, a = 1) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function pick<T>(r: () => number, arr: T[]): T {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

const painters: Record<TileName, (px: Px, r: () => number) => void> = {
  dirt(px, r) {
    const pal = ['#866043', '#79553a', '#8b6a4c', '#96704f', '#6c4a30', '#866043'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, pal));
    for (let i = 0; i < 6; i++) px(Math.floor(r() * 16), Math.floor(r() * 16), '#a8875f');
  },
  grass_top(px, r) {
    const pal = ['#5e9c37', '#6aab3f', '#559030', '#73b546', '#4f8a2c', '#62a23a'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, pal));
    for (let i = 0; i < 10; i++) px(Math.floor(r() * 16), Math.floor(r() * 16), '#86c95a');
  },
  grass_side(px, r) {
    painters.dirt(px, r);
    const pal = ['#5e9c37', '#6aab3f', '#559030', '#73b546'];
    for (let x = 0; x < 16; x++) {
      const d = 3 + Math.floor(r() * 3) - (r() < 0.3 ? 1 : 0);
      for (let y = 0; y < d; y++) px(x, y, pick(r, pal));
      if (r() < 0.25) px(x, d, '#4f8a2c');
    }
  },
  stone(px, r) {
    const pal = ['#7f7f7f', '#8a8a8a', '#747474', '#959595', '#7b7b7b'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, pal));
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(r() * 15), y = Math.floor(r() * 15);
      px(x, y, '#666666'); px(x + 1, y, '#6b6b6b');
      if (r() < 0.5) px(x, y + 1, '#626262');
    }
    for (let i = 0; i < 5; i++) px(Math.floor(r() * 16), Math.floor(r() * 16), '#a3a3a3');
  },
  sand(px, r) {
    const pal = ['#dbcf8e', '#e3d79c', '#d2c584', '#e8dda8', '#dccf92'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, pal));
    for (let i = 0; i < 8; i++) px(Math.floor(r() * 16), Math.floor(r() * 16), '#c4b273');
  },
  gravel(px, r) {
    const pal = ['#7d7672', '#8f8884', '#6a6460', '#9c9590', '#5e5753'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, pal));
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(r() * 15), y = Math.floor(r() * 15);
      const c = pick(r, ['#a8a19c', '#544e4a', '#857059']);
      px(x, y, c); px(x + 1, y, c); px(x, y + 1, c);
    }
  },
  log_side(px, r) {
    const pal = ['#6b4f2c', '#5a4024', '#7a5a33', '#644828'];
    for (let x = 0; x < 16; x++) {
      const base = pick(r, pal);
      for (let y = 0; y < 16; y++) px(x, y, r() < 0.18 ? '#4d361d' : base);
    }
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 14);
      px(x, y, '#3f2c17'); px(x, y + 1, '#3f2c17');
    }
  },
  log_top(px, r) {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        let c: string;
        if (d > 6.6) c = r() < 0.5 ? '#5a4024' : '#6b4f2c';
        else c = Math.floor(d) % 2 === 0 ? '#b8935a' : '#a07c46';
        if (d < 1.2) c = '#8f6c3c';
        px(x, y, c);
      }
  },
  planks(px, r) {
    const pal = ['#b48a52', '#a67c45', '#c09660', '#b08550'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, pal));
    for (let row = 0; row < 4; row++) {
      for (let x = 0; x < 16; x++) px(x, row * 4 + 3, '#7f5d33');
      const seam = (row * 7 + 3) % 16;
      for (let y = row * 4; y < row * 4 + 3; y++) px(seam, y, '#8a6639');
    }
  },
  glass(px) {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const edge = x === 0 || y === 0 || x === 15 || y === 15;
        px(x, y, edge ? '#e6f6ff' : null);
      }
    for (let i = 0; i < 4; i++) px(3 + i, 3 + i, '#ffffff');
    px(4, 3, '#ffffff'); px(10, 9, '#f0fbff'); px(11, 10, '#f0fbff');
    for (let x = 1; x < 15; x++) px(x, 1, '#c6e7f8');
  },
  glowstone(px, r) {
    const pal = ['#ffd27a', '#f7b84a', '#ffe8a8', '#e8a43a', '#fff3c8'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, pal));
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(r() * 15), y = Math.floor(r() * 15);
      px(x, y, '#a8681e'); if (r() < 0.6) px(x + 1, y, '#b8762a');
    }
    for (let i = 0; i < 8; i++) px(Math.floor(r() * 16), Math.floor(r() * 16), '#ffffff');
  },
  snow(px, r) {
    const pal = ['#f3f7fb', '#e8eef5', '#ffffff', '#eef3f8'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, pal));
    for (let i = 0; i < 6; i++) px(Math.floor(r() * 16), Math.floor(r() * 16), '#d7e2ec');
  },
  leaves(px, r) {
    const pal = ['#3f7d2a', '#4d9133', '#356b23', '#5aa23c', '#467f2c'];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) px(x, y, r() < 0.16 ? null : pick(r, pal));
    for (let i = 0; i < 8; i++) px(Math.floor(r() * 16), Math.floor(r() * 16), '#6fbf48');
  },
  water(px, r) {
    const pal = ['#2f6fbf', '#3a7bd5', '#2a62ad', '#3471c4'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, pal));
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(r() * 12), y = Math.floor(r() * 16);
      for (let k = 0; k < 4; k++) px(x + k, y, '#6aa6ec');
    }
  },
  flower_red(px, r) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, null);
    for (let y = 7; y < 16; y++) px(7, y, '#3f8a2a');
    px(6, 12, '#4f9a33'); px(5, 11, '#4f9a33'); px(8, 13, '#4f9a33'); px(9, 12, '#4f9a33');
    const petals: [number, number][] = [[6, 4], [7, 4], [8, 4], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [6, 6], [7, 6], [8, 6], [7, 3]];
    for (const [x, y] of petals) px(x, y, r() < 0.3 ? '#b51f1f' : '#e03a2f');
    px(7, 5, '#2b1a0a');
  },
  flower_yellow(px, r) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, null);
    for (let y = 8; y < 16; y++) px(8, y, '#3f8a2a');
    px(7, 13, '#4f9a33'); px(9, 11, '#4f9a33');
    const petals: [number, number][] = [[7, 5], [8, 5], [9, 5], [7, 6], [8, 6], [9, 6], [7, 7], [8, 7], [9, 7], [8, 4], [6, 6], [10, 6]];
    for (const [x, y] of petals) px(x, y, r() < 0.3 ? '#e2b81c' : '#f8dc3a');
    px(8, 6, '#fff3a0');
  },
  tall_grass(px, r) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, null);
    const pal = ['#5d9e3c', '#6cb046', '#4f8a2c', '#7cc052'];
    for (let blade = 0; blade < 7; blade++) {
      let x = 1 + Math.floor(r() * 14);
      const h = 6 + Math.floor(r() * 9);
      const c = pick(r, pal);
      for (let y = 15; y > 15 - h; y--) {
        px(x, y, c);
        if (r() < 0.18) x = Math.max(0, Math.min(15, x + (r() < 0.5 ? -1 : 1)));
      }
    }
  },
  bedrock(px, r) {
    const pal = ['#565656', '#3a3a3a', '#2a2a2a', '#6b6b6b', '#454545'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, pal));
  },
  gold(px, r) {
    const pal = ['#f5c542', '#ffd95e', '#eab836', '#f9cf4c'];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, pick(r, pal));
    for (let i = 0; i < 16; i++) { px(i, 0, '#fff1a8'); px(0, i, '#fff1a8'); px(i, 15, '#c48a1a'); px(15, i, '#c48a1a'); }
    for (let i = 0; i < 6; i++) px(2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12), '#fffbe0');
  },
};

export interface TileUV { u0: number; v0: number; u1: number; v1: number }

export class TextureAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private uvs = new Map<TileName, TileUV>();
  private pos = new Map<TileName, [number, number]>();
  private avg = new Map<TileName, THREE.Color>();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = COLS * TILE;
    this.canvas.height = ROWS * TILE;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    TILE_ORDER.forEach((name, i) => {
      const cx = (i % COLS) * TILE;
      const cy = Math.floor(i / COLS) * TILE;
      const r = rng(1337 + i * 7919);
      const img = ctx.createImageData(TILE, TILE);
      let rs = 0, gs = 0, bs = 0, n = 0;
      const px: Px = (x, y, color) => {
        if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
        const o = (y * TILE + x) * 4;
        if (!color) { img.data[o + 3] = 0; return; }
        const v = parseInt(color.slice(1), 16);
        img.data[o] = (v >> 16) & 255;
        img.data[o + 1] = (v >> 8) & 255;
        img.data[o + 2] = v & 255;
        img.data[o + 3] = 255;
      };
      painters[name](px, r);
      for (let k = 0; k < img.data.length; k += 4) {
        if (img.data[k + 3] > 0) { rs += img.data[k]; gs += img.data[k + 1]; bs += img.data[k + 2]; n++; }
      }
      ctx.putImageData(img, cx, cy);
      this.pos.set(name, [cx, cy]);
      // 留 0.02 像素内缩，避免相邻贴图采样串色
      const e = 0.02;
      const W = this.canvas.width, H = this.canvas.height;
      this.uvs.set(name, {
        u0: (cx + e) / W,
        u1: (cx + TILE - e) / W,
        // CanvasTexture flipY=true：v=1 对应画布顶部
        v1: 1 - (cy + e) / H,
        v0: 1 - (cy + TILE - e) / H,
      });
      this.avg.set(name, new THREE.Color(`rgb(${Math.round(rs / Math.max(1, n))},${Math.round(gs / Math.max(1, n))},${Math.round(bs / Math.max(1, n))})`));
    });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
  }

  uv(name: string): TileUV {
    return this.uvs.get(name as TileName) ?? this.uvs.get('stone')!;
  }

  averageColor(name: string): THREE.Color {
    return (this.avg.get(name as TileName) ?? this.avg.get('stone')!).clone();
  }

  /** 单张贴图（用于开场动画方块等） */
  tileCanvas(name: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    const [x, y] = this.pos.get(name as TileName) ?? this.pos.get('stone')!;
    c.getContext('2d')!.drawImage(this.canvas, x, y, TILE, TILE, 0, 0, TILE, TILE);
    return c;
  }

  /** 破坏裂纹（多个阶段） */
  static crackTextures(stages = 8): THREE.CanvasTexture[] {
    const out: THREE.CanvasTexture[] = [];
    const r = rng(4242);
    // 预生成裂纹路径
    const lines: { x: number; y: number }[][] = [];
    for (let l = 0; l < 10; l++) {
      let x = 8 + (r() - 0.5) * 4, y = 8 + (r() - 0.5) * 4;
      const pts = [{ x, y }];
      const ang = r() * Math.PI * 2;
      for (let i = 0; i < 6; i++) {
        x += Math.cos(ang + (r() - 0.5) * 1.6) * 1.6;
        y += Math.sin(ang + (r() - 0.5) * 1.6) * 1.6;
        pts.push({ x, y });
      }
      lines.push(pts);
    }
    for (let s = 0; s < stages; s++) {
      const c = document.createElement('canvas');
      c.width = c.height = TILE;
      const ctx = c.getContext('2d')!;
      const p = (s + 1) / stages;
      const nLines = Math.ceil(p * lines.length);
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      for (let l = 0; l < nLines; l++) {
        const pts = lines[l];
        const len = Math.ceil(pts.length * Math.min(1, p * 1.4));
        for (let i = 0; i < len; i++) {
          const px = Math.floor(pts[i].x), py = Math.floor(pts[i].y);
          if (px >= 0 && py >= 0 && px < 16 && py < 16) ctx.fillRect(px, py, 1, 1);
        }
      }
      const tex = new THREE.CanvasTexture(c);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      out.push(tex);
    }
    return out;
  }
}

let shared: TextureAtlas | null = null;
export function getAtlas(): TextureAtlas {
  if (!shared) shared = new TextureAtlas();
  return shared;
}

export { hexA };
