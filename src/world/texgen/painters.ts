import { clamp01, fbm, fbm2, hash2, hex, lerp, mixRGB, ramp, smoothstep, vnoise, worley, type RGB, type WorleyOut } from './noise';

/**
 * 「材质包 256x」程序化 PBR 画师：每个贴图是一个 (u,v) → 像素 的函数，
 * 同时输出反照率、高度（→法线/缝隙 AO）、粗糙度、金属度、自发光、湿润度。
 * u,v ∈ [0,1)，v 向下（图像坐标）。所有图案周期平铺，相邻方块无缝。
 */

export const TILE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobblestone', 'bricks', 'stone_bricks',
  'oak_planks', 'birch_planks', 'spruce_planks', 'oak_log', 'oak_log_top', 'birch_log', 'birch_log_top',
  'spruce_log', 'spruce_log_top', 'leaves', 'glass', 'glowstone', 'snow', 'ice', 'sand', 'sandstone',
  'sandstone_top', 'gravel', 'clay', 'water', 'flower_red', 'flower_yellow', 'tall_grass', 'bedrock',
  'gold', 'iron', 'diamond', 'bookshelf', 'quartz', 'wool_white', 'wool_red', 'wool_yellow', 'wool_blue',
  'wool_green', 'wool_black', 'sea_lantern', 'lantern', 'redstone_lamp',
] as const;

export type TileName = (typeof TILE_NAMES)[number];

export interface Px {
  r: number; g: number; b: number; a: number;
  h: number; rough: number; metal: number; emit: number; wet: number;
}

export interface TileSpec {
  paint: (u: number, v: number, o: Px) => void;
  /** 法线强度 */
  normal: number;
  /** “像素块”色调抖动幅度（保留方块感） */
  pixel: number;
}

const W: WorleyOut = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
const W2: WorleyOut = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
const C: RGB = [0, 0, 0];

function put(o: Px, c: RGB, h: number, rough: number, wet = 0, metal = 0, emit = 0, a = 1) {
  o.r = c[0]; o.g = c[1]; o.b = c[2]; o.a = a;
  o.h = h; o.rough = rough; o.metal = metal; o.emit = emit; o.wet = wet;
}

const tint = (c: RGB, k: number): RGB => { C[0] = c[0] * k; C[1] = c[1] * k; C[2] = c[2] * k; return C; };

// ───────── 基础材质 ─────────

const DIRT = [hex(0x5a3b22), hex(0x7a5233), hex(0x8f6643), hex(0xa07a55)];
function dirt(u: number, v: number, o: Px) {
  const n = fbm(u, v, 6, 5, 11);
  worley(u, v, 11, 12, W);
  const pebble = smoothstep(0.32, 0.12, W.f1) * (hash2(W.id, 1, 13) > 0.55 ? 1 : 0);
  ramp(DIRT, n * 0.9 + hash2(W.id, 3, 14) * 0.1, C);
  if (pebble > 0) mixRGB(C, hex(0x9c8a74), pebble * 0.7, C);
  put(o, C, n * 0.5 + pebble * 0.45, 0.95, 0.35);
}

const GRASS = [hex(0x3f6a27), hex(0x507f35), hex(0x619244), hex(0x75a655), hex(0x8ab866)];
function grassTop(u: number, v: number, o: Px) {
  const n = fbm(u, v, 5, 4, 21);
  // 草叶：高频各向异性条纹
  const blades = fbm2(u, v, 40, 14, 2, 22);
  const tuft = smoothstep(0.45, 0.8, blades);
  ramp(GRASS, clamp01(n * 0.65 + tuft * 0.5 - 0.1), C);
  put(o, C, n * 0.4 + tuft * 0.6, 0.88, 0.25);
}

function grassSide(u: number, v: number, o: Px) {
  dirt(u, v, o);
  const edge = 0.17 + (fbm(u, 0.5, 8, 3, 31) - 0.5) * 0.12;
  const drip = hash2(Math.floor(u * 16), 5, 32) > 0.72 ? 0.07 + hash2(Math.floor(u * 16), 6, 33) * 0.1 : 0;
  const lim = edge + drip;
  if (v < lim) {
    const n = fbm(u, v, 6, 4, 34);
    ramp(GRASS, clamp01(n * 0.7 + 0.15 - v * 0.6), C);
    put(o, C, 0.75 + n * 0.25, 0.88, 0.25);
  } else if (v < lim + 0.03) {
    // 草根阴影
    o.r *= 0.7; o.g *= 0.72; o.b *= 0.7; o.h *= 0.6;
  }
}

const STONE = [hex(0x5d5d5d), hex(0x6f6f6f), hex(0x7f7f7f), hex(0x8e8e8e), hex(0x9c9c9c)];
function stone(u: number, v: number, o: Px) {
  const n = fbm(u, v, 4, 5, 41);
  const m = fbm(u, v, 12, 3, 42);
  worley(u, v, 5, 43, W);
  const crack = smoothstep(0.045, 0.0, W.f2 - W.f1) * smoothstep(0.35, 0.6, fbm(u, v, 3, 2, 44));
  ramp(STONE, clamp01(n * 0.75 + m * 0.35 - 0.05), C);
  tint(C, 1 - crack * 0.45);
  put(o, C, n * 0.6 + m * 0.3 - crack * 0.5 + 0.2, lerp(0.62, 0.85, m), 0.85);
}

function cobblestone(u: number, v: number, o: Px) {
  worley(u, v, 5, 51, W);
  const edge = W.f2 - W.f1;
  const n = fbm(u, v, 10, 4, 52);
  const shade = hash2(W.id, 2, 53);
  const dome = smoothstep(0.0, 0.32, edge);
  ramp(STONE, clamp01(shade * 0.6 + n * 0.45 + dome * 0.15 - 0.1), C);
  if (edge < 0.07) {
    mixRGB(C, hex(0x3a3a3a), smoothstep(0.07, 0.0, edge), C);
  }
  put(o, C, dome * 0.8 + n * 0.2, lerp(0.55, 0.85, n), 0.9);
}

function brickWall(
  u: number, v: number, o: Px,
  rows: number, perRow: number, mortarW: number,
  brick: RGB[], mortar: RGB, seed: number, wet: number, rough: number,
) {
  const row = Math.floor(v * rows);
  const off = row % 2 ? 0.5 / perRow : 0;
  const uu = (u + off) % 1;
  const col = Math.floor(uu * perRow);
  const lu = uu * perRow - col, lv = v * rows - row;
  const mw = mortarW * perRow, mh = mortarW * rows;
  const du = Math.min(lu, 1 - lu) / mw, dv = Math.min(lv, 1 - lv) / mh;
  const d = Math.min(du, dv * (mw / mh));
  const id = row * 17 + ((col + perRow) % perRow);
  const n = fbm(u, v, 16, 3, seed);
  if (Math.min(du, dv) < 1) {
    const mn = fbm(u, v, 32, 2, seed + 5);
    mixRGB(mortar, tint(mortar, 0.8), mn, C);
    put(o, C, 0.05 + mn * 0.1, 0.95, wet * 0.6);
    return;
  }
  const bevel = smoothstep(1, 2.6, d);
  ramp(brick, clamp01(hash2(id, 9, seed) * 0.6 + n * 0.5), C);
  tint(C, 0.82 + bevel * 0.18);
  put(o, C, 0.45 + bevel * 0.4 + n * 0.15, rough, wet);
}

const BRICK = [hex(0x7e3a2b), hex(0x96483a), hex(0xa85a45), hex(0xb46a52)];
const bricks = (u: number, v: number, o: Px) => brickWall(u, v, o, 4, 2, 0.022, BRICK, hex(0xb3aa9c), 61, 0.6, 0.86);
const STONEB = [hex(0x6c6c6c), hex(0x7b7b7b), hex(0x888888), hex(0x949494)];
const stoneBricks = (u: number, v: number, o: Px) => brickWall(u, v, o, 2, 2, 0.02, STONEB, hex(0x4a4a4a), 71, 0.9, 0.7);

function planks(base: RGB[], seam: RGB, seed: number) {
  return (u: number, v: number, o: Px) => {
    const board = Math.floor(v * 4);
    const lv = v * 4 - board;
    const seamU = (hash2(board, 1, seed) * 0.6 + 0.2);
    const grain = fbm2(u + board * 0.37, v, 2, 30, 4, seed + board);
    const fine = fbm2(u, v, 6, 90, 2, seed + 9);
    ramp(base, clamp01(grain * 0.8 + fine * 0.3 + hash2(board, 2, seed) * 0.15 - 0.1), C);
    let h = 0.55 + grain * 0.3;
    const edgeV = Math.min(lv, 1 - lv);
    if (edgeV < 0.06) {
      mixRGB(C, seam, smoothstep(0.06, 0.0, edgeV), C);
      h = 0.15;
    }
    const du = Math.abs(u - seamU);
    if (du < 0.012) {
      mixRGB(C, seam, 0.8, C);
      h = 0.15;
    }
    // 钉子
    const nail = Math.hypot((u - seamU - 0.05) * 4, (lv - 0.5)) ;
    if (nail < 0.05) { tint(C, 0.55); h = 0.3; }
    put(o, C, h, 0.62 + fine * 0.2, 0.35);
  };
}
const OAK = [hex(0x8a6436), hex(0xa27a46), hex(0xb48a52), hex(0xc39a62)];
const BIRCH = [hex(0xc2ad78), hex(0xd2bf8c), hex(0xddcb98), hex(0xe7d8aa)];
const SPRUCE = [hex(0x4f3720), hex(0x5f432a), hex(0x6e5033), hex(0x7a5b3c)];

function logSide(bark: RGB[], seed: number, birch = false) {
  return (u: number, v: number, o: Px) => {
    if (birch) {
      const n = fbm(u, v, 6, 4, seed);
      ramp(bark, n, C);
      // 横向黑色皮孔
      const row = Math.floor(v * 10);
      const r = hash2(row, 1, seed);
      const x0 = hash2(row, 2, seed), len = 0.15 + hash2(row, 3, seed) * 0.35;
      const du = ((u - x0) % 1 + 1) % 1;
      const lv = v * 10 - row;
      let h = 0.6 + n * 0.2;
      if (r > 0.35 && du < len && Math.abs(lv - 0.5) < 0.18 + 0.1 * vnoise(u * 20, row, 20, seed)) {
        mixRGB(C, hex(0x2b2722), 0.9, C);
        h = 0.2;
      }
      put(o, C, h, 0.7, 0.3);
      return;
    }
    const g = fbm2(u, v, 14, 2, 4, seed);
    const groove = smoothstep(0.42, 0.25, g);
    const n = fbm(u, v, 8, 3, seed + 3);
    ramp(bark, clamp01(g * 0.9 + n * 0.25 - 0.1), C);
    tint(C, 1 - groove * 0.5);
    put(o, C, g * 0.8 + n * 0.2, 0.92, 0.5);
  };
}

function logTop(rings: RGB[], bark: RGB, seed: number) {
  return (u: number, v: number, o: Px) => {
    const x = u - 0.5, y = v - 0.5;
    const sq = Math.max(Math.abs(x), Math.abs(y));
    const ci = Math.hypot(x, y);
    const r = lerp(ci, sq, 0.55) + (fbm(u, v, 6, 3, seed) - 0.5) * 0.04;
    const n = fbm(u, v, 20, 2, seed + 1);
    if (r > 0.43) {
      const b = fbm2(u, v, 12, 12, 3, seed + 2);
      mixRGB(bark, tint(bark, 0.6), b, C);
      put(o, C, 0.4 + b * 0.3, 0.9, 0.4);
      return;
    }
    const ring = 0.5 + 0.5 * Math.sin(r * 70 + fbm(u, v, 4, 2, seed + 3) * 3);
    ramp(rings, clamp01(ring * 0.7 + n * 0.3), C);
    if (r > 0.4) tint(C, 0.75);
    put(o, C, 0.5 + ring * 0.15 - (r > 0.4 ? 0.2 : 0), 0.75, 0.3);
  };
}

const LEAF = [hex(0x24521a), hex(0x2f6a20), hex(0x3d8228), hex(0x4f9a33), hex(0x66b043)];
function leaves(u: number, v: number, o: Px) {
  worley(u, v, 9, 81, W);
  const n = fbm(u, v, 8, 3, 82);
  const leaf = smoothstep(0.62, 0.15, W.f1);
  const hole = fbm(u, v, 6, 3, 83) > 0.64 && leaf < 0.5;
  ramp(LEAF, clamp01(leaf * 0.6 + hash2(W.id, 1, 84) * 0.35 + n * 0.2 - 0.1), C);
  put(o, C, leaf * 0.8 + n * 0.2, 0.7, 0.2, 0, 0, hole ? 0 : 1);
}

function glass(u: number, v: number, o: Px) {
  const b = Math.min(u, v, 1 - u, 1 - v);
  const frame = b < 0.055;
  const streak = Math.abs((u - v) - 0.18) < 0.025 && u > 0.2 && u < 0.5;
  const streak2 = Math.abs((u - v) - 0.24) < 0.012 && u > 0.28 && u < 0.62;
  if (frame) {
    mixRGB(hex(0xd8eef6), hex(0xa8c8d6), smoothstep(0.0, 0.055, b), C);
    put(o, C, 0.9 - b * 4, 0.12, 0, 0, 0, 1);
  } else if (streak || streak2) {
    put(o, hex(0xf4fbff), 0.6, 0.05, 0, 0, 0, 1);
  } else put(o, hex(0xd6eef8), 0.5, 0.05, 0, 0, 0, 0);
}

const GLOW = [hex(0x7a4a12), hex(0xc27a22), hex(0xf2b445), hex(0xffd780), hex(0xfff2c4)];
function glowstone(u: number, v: number, o: Px) {
  worley(u, v, 7, 91, W);
  const e = W.f2 - W.f1;
  const n = fbm(u, v, 12, 3, 92);
  const core = smoothstep(0.02, 0.3, e) * (0.6 + hash2(W.id, 1, 93) * 0.4);
  ramp(GLOW, clamp01(core * 0.9 + n * 0.2), C);
  put(o, C, core * 0.8 + n * 0.2, 0.55, 0, 0, clamp01(core * 1.1));
}

function seaLantern(u: number, v: number, o: Px) {
  const b = Math.min(u, v, 1 - u, 1 - v);
  const n = fbm(u, v, 10, 3, 101);
  const cell = Math.min(Math.abs(((u * 3) % 1) - 0.5), Math.abs(((v * 3) % 1) - 0.5));
  const line = smoothstep(0.43, 0.5, Math.max(Math.abs(((u * 3) % 1) - 0.5), Math.abs(((v * 3) % 1) - 0.5)));
  const glowc = mixRGB(hex(0xbfe9e4), hex(0xffffff), clamp01(n * 0.8 + cell), [0, 0, 0]);
  if (b < 0.07) {
    mixRGB(hex(0x6fa8a6), hex(0x9ccfcc), n, C);
    put(o, C, 0.8, 0.35, 0, 0, 0.25);
  } else {
    mixRGB(glowc, hex(0x7fbcb8), line * 0.7, C);
    put(o, C, 0.5 - line * 0.3 + n * 0.1, 0.3, 0, 0, clamp01(1 - line * 0.6));
  }
}

function lantern(u: number, v: number, o: Px) {
  const b = Math.min(u, v, 1 - u, 1 - v);
  const bar = Math.abs(u - 0.5) < 0.035 || Math.abs(v - 0.5) < 0.035;
  const n = fbm(u, v, 12, 3, 111);
  if (b < 0.1 || bar) {
    mixRGB(hex(0x2a2c33), hex(0x4a4e58), n * 0.8 + (b < 0.03 ? 0.3 : 0), C);
    put(o, C, b < 0.1 ? 0.85 : 0.75, 0.38, 0.3, 0.85, 0);
  } else {
    const flame = smoothstep(0.55, 0.0, Math.hypot(((u * 2) % 1) - 0.5, ((v * 2) % 1) - 0.55));
    mixRGB(hex(0xe98a2e), hex(0xfff0b0), clamp01(flame + n * 0.2), C);
    put(o, C, 0.4, 0.2, 0, 0, 0.75 + flame * 0.25);
  }
}

function redstoneLamp(u: number, v: number, o: Px) {
  worley(u, v, 5, 121, W);
  const e = W.f2 - W.f1;
  const n = fbm(u, v, 12, 3, 122);
  const b = Math.min(u, v, 1 - u, 1 - v);
  if (b < 0.06 || e < 0.05) {
    mixRGB(hex(0x5a3a1c), hex(0x8a5a2a), n, C);
    put(o, C, 0.35, 0.6, 0.2, 0, 0.1);
  } else {
    const k = smoothstep(0.05, 0.35, e);
    mixRGB(hex(0xd8782a), hex(0xffe6a0), clamp01(k * 0.8 + n * 0.3), C);
    put(o, C, 0.5 + k * 0.4, 0.4, 0, 0, 0.6 + k * 0.4);
  }
}

function snow(u: number, v: number, o: Px) {
  const n = fbm(u, v, 6, 4, 131);
  const sp = hash2(Math.floor(u * 96), Math.floor(v * 96), 132) > 0.985 ? 1 : 0;
  mixRGB(hex(0xdfe8f2), hex(0xffffff), n * 0.8 + sp * 0.3, C);
  put(o, C, n * 0.6, 0.55 - sp * 0.4, 0.2);
}

function ice(u: number, v: number, o: Px) {
  const n = fbm(u, v, 4, 4, 141);
  worley(u, v, 4, 142, W);
  const crack = smoothstep(0.03, 0.0, W.f2 - W.f1);
  mixRGB(hex(0x7fa9e8), hex(0xb9d6ff), n, C);
  mixRGB(C, hex(0xeaf4ff), crack * 0.8, C);
  put(o, C, 0.6 - crack * 0.4 + n * 0.1, 0.06 + crack * 0.3, 0);
}

const SAND = [hex(0xc8b67a), hex(0xd8c88e), hex(0xe2d39c), hex(0xece0b0)];
function sand(u: number, v: number, o: Px) {
  const n = fbm(u, v, 6, 4, 151);
  const grain = hash2(Math.floor(u * 128), Math.floor(v * 128), 152);
  const ripple = 0.5 + 0.5 * Math.sin((v * 9 + fbm(u, v, 3, 2, 153) * 2.2) * Math.PI * 2);
  ramp(SAND, clamp01(n * 0.6 + grain * 0.25 + ripple * 0.15), C);
  put(o, C, n * 0.3 + ripple * 0.35 + grain * 0.15, 0.95, 0.4);
}

const SANDST = [hex(0xc9b47a), hex(0xd8c48a), hex(0xe0cf98), hex(0xe9daa8)];
function sandstone(u: number, v: number, o: Px) {
  const n = fbm(u, v, 8, 3, 161);
  const layer = fbm2(u, v, 2, 16, 3, 162);
  let c = clamp01(layer * 0.7 + n * 0.3);
  let h = 0.5 + layer * 0.3;
  if (v < 0.2) { c = clamp01(c + 0.2); h += 0.15; }
  if (Math.abs(v - 0.2) < 0.015 || v > 0.93) { c *= 0.6; h = 0.2; }
  ramp(SANDST, c, C);
  put(o, C, h, 0.9, 0.5);
}
function sandstoneTop(u: number, v: number, o: Px) {
  const n = fbm(u, v, 8, 4, 171);
  const sp = hash2(Math.floor(u * 64), Math.floor(v * 64), 172);
  ramp(SANDST, clamp01(n * 0.7 + sp * 0.3), C);
  put(o, C, n * 0.5 + sp * 0.1, 0.88, 0.5);
}

const GRAVEL = [hex(0x4f4a46), hex(0x6a6460), hex(0x857e79), hex(0x9e9792), hex(0x7d6e5e)];
function gravel(u: number, v: number, o: Px) {
  worley(u, v, 10, 181, W);
  const e = W.f2 - W.f1;
  const dome = smoothstep(0.0, 0.3, e);
  const n = fbm(u, v, 24, 2, 182);
  ramp(GRAVEL, clamp01(hash2(W.id, 1, 183) * 0.85 + n * 0.2), C);
  tint(C, 0.55 + dome * 0.45);
  put(o, C, dome * 0.85 + n * 0.15, 0.85, 0.8);
}

function clay(u: number, v: number, o: Px) {
  const n = fbm(u, v, 5, 4, 191);
  const m = fbm(u, v, 20, 2, 192);
  mixRGB(hex(0x8f96a6), hex(0xa7aebd), n * 0.8 + m * 0.2, C);
  put(o, C, n * 0.4 + m * 0.1, 0.78, 0.6);
}

function water(u: number, v: number, o: Px) {
  const n = fbm(u, v, 4, 4, 201);
  mixRGB(hex(0x24589e), hex(0x4a86d0), n, C);
  put(o, C, n, 0.05, 0);
}

function bedrock(u: number, v: number, o: Px) {
  worley(u, v, 8, 211, W);
  const n = fbm(u, v, 10, 4, 212);
  const k = hash2(W.id, 1, 213);
  mixRGB(hex(0x202020), hex(0x6a6a6a), clamp01(k * 0.7 + n * 0.5 - 0.15), C);
  put(o, C, k * 0.6 + n * 0.4, 0.9, 0.5);
}

function metalBlock(base: RGB, hi: RGB, lo: RGB, metal: number, rough: number, seed: number) {
  return (u: number, v: number, o: Px) => {
    const b = Math.min(u, v, 1 - u, 1 - v);
    const brushed = fbm2(u, v, 1, 64, 3, seed);
    const n = fbm(u, v, 8, 3, seed + 1);
    let h = 0.6;
    if (b < 0.07) {
      const t = b / 0.07;
      // 倒角：左上亮、右下暗
      const lit = u < 1 - v ? 1 : 0;
      mixRGB(lit ? hi : lo, base, t, C);
      h = 0.6 + t * 0.35;
    } else {
      mixRGB(base, hi, brushed * 0.35 + n * 0.15, C);
      h = 0.95;
      // 内框刻线
      if (Math.abs(b - 0.12) < 0.008) { tint(C, 0.75); h = 0.8; }
    }
    put(o, C, h, rough + brushed * 0.12, 0.1, metal, 0);
  };
}
const gold = metalBlock(hex(0xf1c043), hex(0xfff09a), hex(0xa8741a), 1, 0.28, 221);
const iron = metalBlock(hex(0xc9cbcf), hex(0xf2f3f5), hex(0x8a8d93), 1, 0.33, 231);

function diamond(u: number, v: number, o: Px) {
  const b = Math.min(u, v, 1 - u, 1 - v);
  worley(u, v, 4, 241, W);
  const facet = hash2(W.id, 1, 242);
  const n = fbm(u, v, 10, 2, 243);
  mixRGB(hex(0x3fc6c0), hex(0xbaf5ef), clamp01(facet * 0.7 + n * 0.3), C);
  let h = 0.5 + facet * 0.4;
  if (W.f2 - W.f1 < 0.025) { mixRGB(C, hex(0xffffff), 0.6, C); h = 0.95; }
  if (b < 0.06) { tint(C, 0.7 + b * 4); h = 0.6; }
  put(o, C, h, 0.12, 0.2, 0.15, 0);
}

const BOOKS = [hex(0x7a2a24), hex(0x2f4e7a), hex(0x2e6a3a), hex(0x8a6a2a), hex(0x5a2e6a), hex(0x9a4a2a), hex(0x2a5a5a)];
const oakPlanks = planks(OAK, hex(0x5e4022), 251);
function bookshelf(u: number, v: number, o: Px) {
  const shelfTop = v < 0.1, shelfBot = v > 0.9, mid = Math.abs(v - 0.5) < 0.05;
  if (shelfTop || shelfBot || mid) { oakPlanks(u, v, o); o.h = 0.9; return; }
  const row = v < 0.5 ? 0 : 1;
  // 书本宽度随机：按 u 累计
  let x = 0, i = 0, w = 0.1;
  for (; i < 16; i++) {
    w = 0.07 + hash2(i, row, 261) * 0.07;
    if (u < x + w) break;
    x += w;
  }
  const lu = (u - x) / w;
  const top = row === 0 ? 0.1 : 0.55;
  const bookH = 0.32 + hash2(i, row + 4, 262) * 0.08;
  const lv = (v - top) / 0.35;
  if (lv < 1 - bookH / 0.4 && hash2(i, row + 8, 263) > 0.5) {
    put(o, hex(0x2a1c10), 0.1, 0.9, 0.1);
    return;
  }
  const col = BOOKS[Math.floor(hash2(i, row + 2, 264) * BOOKS.length)];
  const n = fbm(u, v, 20, 2, 265);
  mixRGB(col, tint(col, 1.25), n * 0.5, C);
  const band = Math.abs(lv - 0.25) < 0.04 || Math.abs(lv - 0.8) < 0.04;
  if (band) mixRGB(C, hex(0xd8b45a), 0.7, C);
  const edge = Math.min(lu, 1 - lu);
  tint(C, 0.6 + smoothstep(0, 0.2, edge) * 0.4);
  put(o, C, 0.5 + smoothstep(0, 0.2, edge) * 0.3, 0.6, 0.1);
}

function quartz(u: number, v: number, o: Px) {
  const n = fbm(u, v, 3, 5, 271);
  const vein = smoothstep(0.012, 0.0, Math.abs(fbm(u, v, 3, 4, 272) - 0.5)) * 0.18;
  const b = Math.min(u, v, 1 - u, 1 - v);
  mixRGB(hex(0xe6e0d6), hex(0xf8f5ef), n, C);
  mixRGB(C, hex(0xc8c0b6), vein, C);
  let h = 0.7 + n * 0.1;
  if (b < 0.04) { tint(C, 0.88); h = 0.5; }
  put(o, C, h, 0.32 + n * 0.1, 0.3);
}

function wool(col: RGB, seed: number) {
  return (u: number, v: number, o: Px) => {
    const n = fbm(u, v, 8, 4, seed);
    const fib = fbm2(u, v, 32, 6, 2, seed + 1) * 0.5 + fbm2(u, v, 6, 32, 2, seed + 2) * 0.5;
    const weave = 0.5 + 0.5 * Math.sin(u * 32 * Math.PI) * Math.sin(v * 32 * Math.PI);
    const k = 0.8 + (n - 0.5) * 0.25 + (fib - 0.5) * 0.35 + weave * 0.06;
    put(o, tint(col, k), n * 0.4 + fib * 0.4 + weave * 0.2, 0.98, 0.1);
  };
}

function plant(kind: 'red' | 'yellow' | 'grass') {
  return (u: number, v: number, o: Px) => {
    o.a = 0; o.r = o.g = o.b = 0; o.h = 0.5; o.rough = 0.7; o.metal = 0; o.emit = 0; o.wet = 0.2;
    if (kind === 'grass') {
      for (let k = 0; k < 9; k++) {
        const x0 = 0.08 + hash2(k, 1, 281) * 0.84;
        const hgt = 0.45 + hash2(k, 2, 282) * 0.5;
        const lean = (hash2(k, 3, 283) - 0.5) * 0.3;
        const t = (1 - v) / hgt;
        if (t < 0 || t > 1) continue;
        const cx = x0 + lean * t * t;
        const w = 0.035 * (1 - t) + 0.006;
        if (Math.abs(u - cx) < w) {
          ramp(GRASS, clamp01(0.2 + t * 0.7 + hash2(k, 4, 284) * 0.2), C);
          put(o, C, 0.5 + (1 - Math.abs(u - cx) / w) * 0.4, 0.7, 0.2);
          return;
        }
      }
      return;
    }
    // 茎 + 叶
    const stem = Math.abs(u - 0.5 - Math.sin(v * 6) * 0.01) < 0.025 && v > 0.35;
    const leafL = Math.hypot((u - 0.38) * 1.6, v - 0.74) < 0.08;
    const leafR = Math.hypot((u - 0.62) * 1.6, v - 0.8) < 0.07;
    if (stem || leafL || leafR) { mixRGB(hex(0x2f6a20), hex(0x5aa23c), v * 0.5, C); put(o, C, 0.5, 0.7, 0.2); return; }
    const cx = 0.5, cy = 0.3;
    const dx = u - cx, dy = v - cy;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const petals = kind === 'red' ? 4 : 10;
    const R = (kind === 'red' ? 0.2 : 0.17) * (0.75 + 0.25 * Math.cos(ang * petals));
    if (r < R) {
      if (r < (kind === 'red' ? 0.05 : 0.06)) {
        put(o, kind === 'red' ? hex(0x241a10) : hex(0xffe98a), 0.9, 0.6, 0.1);
      } else {
        const base = kind === 'red' ? hex(0xd8302f) : hex(0xf2c81e);
        const hi = kind === 'red' ? hex(0xff6a50) : hex(0xffe86a);
        mixRGB(base, hi, 1 - r / R, C);
        put(o, C, 0.6 + (1 - r / R) * 0.3, 0.6, 0.1);
      }
    }
  };
}

void W2;

export const TILES: Record<TileName, TileSpec> = {
  grass_top: { paint: grassTop, normal: 1.5, pixel: 0.06 },
  grass_side: { paint: grassSide, normal: 2.6, pixel: 0.06 },
  dirt: { paint: dirt, normal: 2.6, pixel: 0.07 },
  stone: { paint: stone, normal: 3.0, pixel: 0.05 },
  cobblestone: { paint: cobblestone, normal: 4.5, pixel: 0.04 },
  bricks: { paint: bricks, normal: 4.0, pixel: 0.04 },
  stone_bricks: { paint: stoneBricks, normal: 4.0, pixel: 0.04 },
  oak_planks: { paint: oakPlanks, normal: 2.6, pixel: 0.04 },
  birch_planks: { paint: planks(BIRCH, hex(0x9a8458), 252), normal: 2.4, pixel: 0.04 },
  spruce_planks: { paint: planks(SPRUCE, hex(0x34230f), 253), normal: 2.6, pixel: 0.04 },
  oak_log: { paint: logSide([hex(0x3a2a16), hex(0x4f3a20), hex(0x664a2a), hex(0x765834)], 291), normal: 4.5, pixel: 0.04 },
  oak_log_top: { paint: logTop([hex(0x9a7444), hex(0xb48a52), hex(0xc8a066)], hex(0x4f3a20), 292), normal: 2.5, pixel: 0.03 },
  birch_log: { paint: logSide([hex(0xcfcac0), hex(0xe2ddd2), hex(0xf2efe8)], 293, true), normal: 2.5, pixel: 0.03 },
  birch_log_top: { paint: logTop([hex(0xc2ad78), hex(0xd8c490), hex(0xe2d0a0)], hex(0xd8d4ca), 294), normal: 2.5, pixel: 0.03 },
  spruce_log: { paint: logSide([hex(0x261a0e), hex(0x352414), hex(0x45301c), hex(0x523a22)], 295), normal: 4.5, pixel: 0.04 },
  spruce_log_top: { paint: logTop([hex(0x6a4c2c), hex(0x7e5c36), hex(0x8e6a40)], hex(0x352414), 296), normal: 2.5, pixel: 0.03 },
  leaves: { paint: leaves, normal: 3.0, pixel: 0.06 },
  glass: { paint: glass, normal: 1.5, pixel: 0 },
  glowstone: { paint: glowstone, normal: 3.5, pixel: 0.04 },
  snow: { paint: snow, normal: 1.4, pixel: 0.02 },
  ice: { paint: ice, normal: 1.8, pixel: 0.02 },
  sand: { paint: sand, normal: 1.8, pixel: 0.04 },
  sandstone: { paint: sandstone, normal: 2.6, pixel: 0.03 },
  sandstone_top: { paint: sandstoneTop, normal: 1.8, pixel: 0.03 },
  gravel: { paint: gravel, normal: 4.0, pixel: 0.04 },
  clay: { paint: clay, normal: 1.4, pixel: 0.03 },
  water: { paint: water, normal: 1, pixel: 0 },
  flower_red: { paint: plant('red'), normal: 1.5, pixel: 0 },
  flower_yellow: { paint: plant('yellow'), normal: 1.5, pixel: 0 },
  tall_grass: { paint: plant('grass'), normal: 1.5, pixel: 0 },
  bedrock: { paint: bedrock, normal: 4, pixel: 0.05 },
  gold: { paint: gold, normal: 3, pixel: 0.02 },
  iron: { paint: iron, normal: 3, pixel: 0.02 },
  diamond: { paint: diamond, normal: 3, pixel: 0.02 },
  bookshelf: { paint: bookshelf, normal: 3.2, pixel: 0.03 },
  quartz: { paint: quartz, normal: 1.6, pixel: 0.02 },
  wool_white: { paint: wool(hex(0xeeeeee), 301), normal: 2.2, pixel: 0.03 },
  wool_red: { paint: wool(hex(0xb02e26), 302), normal: 2.2, pixel: 0.03 },
  wool_yellow: { paint: wool(hex(0xf2c42c), 303), normal: 2.2, pixel: 0.03 },
  wool_blue: { paint: wool(hex(0x3c44aa), 304), normal: 2.2, pixel: 0.03 },
  wool_green: { paint: wool(hex(0x5e9c22), 305), normal: 2.2, pixel: 0.03 },
  wool_black: { paint: wool(hex(0x2a2a30), 306), normal: 2.2, pixel: 0.03 },
  sea_lantern: { paint: seaLantern, normal: 2.5, pixel: 0.02 },
  lantern: { paint: lantern, normal: 3, pixel: 0.02 },
  redstone_lamp: { paint: redstoneLamp, normal: 3, pixel: 0.03 },
};
