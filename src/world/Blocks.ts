/** 方块注册表：所有方块的渲染/物理/贴图/分类属性集中定义于此 */
import type { TileName } from './texgen/painters';
export type { TileName } from './texgen/painters';

export const B = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  LOG: 5,
  PLANKS: 6,
  GLASS: 7,
  GLOWSTONE: 8,
  SNOW: 9,
  LEAVES: 10,
  WATER: 11,
  FLOWER_RED: 12,
  FLOWER_YELLOW: 13,
  TALL_GRASS: 14,
  BEDROCK: 15,
  GOLD: 16,
  GRAVEL: 17,
  COBBLESTONE: 18,
  BRICKS: 19,
  STONE_BRICKS: 20,
  BIRCH_PLANKS: 21,
  SPRUCE_PLANKS: 22,
  BIRCH_LOG: 23,
  SPRUCE_LOG: 24,
  SANDSTONE: 25,
  CLAY: 26,
  ICE: 27,
  QUARTZ: 28,
  BOOKSHELF: 29,
  IRON: 30,
  DIAMOND: 31,
  WOOL_WHITE: 32,
  WOOL_RED: 33,
  WOOL_YELLOW: 34,
  WOOL_BLUE: 35,
  WOOL_GREEN: 36,
  WOOL_BLACK: 37,
  SEA_LANTERN: 38,
  LANTERN: 39,
  REDSTONE_LAMP: 40,
} as const;

/** opaque: 实心不透明立方体；cutout: alpha 测试立方体（树叶/玻璃）；cross: 十字交叉植物；water: 水；none: 空气 */
export type RenderKind = 'none' | 'opaque' | 'cutout' | 'cross' | 'water';

/** 创造模式物品栏分类 */
export type Category = 'build' | 'nature' | 'decor' | 'light';
export const CATEGORIES: { id: Category; nameZh: string; icon: number }[] = [
  { id: 'build', nameZh: '建筑', icon: B.BRICKS },
  { id: 'nature', nameZh: '自然', icon: B.GRASS },
  { id: 'decor', nameZh: '装饰', icon: B.WOOL_RED },
  { id: 'light', nameZh: '光源', icon: B.GLOWSTONE },
];

export interface BlockDef {
  id: number;
  key: string;
  nameZh: string;
  render: RenderKind;
  /** 是否参与碰撞 */
  solid: boolean;
  tiles: { top: TileName; bottom: TileName; side: TileName };
  /** 自发光强度（HDR，>1 会触发辉光） */
  emissive: number;
  /** 方块光源等级 0..15（体素光照洪泛） */
  light: number;
  /** 随风摆动强度 */
  sway: number;
  /** 破坏所需秒数 */
  hardness: number;
  /** 破坏粒子颜色 */
  particle: number;
  /** 是否可被放置覆盖（水、草丛、花） */
  replaceable: boolean;
  /** 物品栏分类（null = 不出现在创造物品栏） */
  category: Category | null;
}

const t = (top: TileName, side: TileName = top, bottom: TileName = top) => ({ top, side, bottom });

const defs: BlockDef[] = [];
function def(d: Partial<BlockDef> & Pick<BlockDef, 'id' | 'key' | 'nameZh' | 'render' | 'tiles'>) {
  defs[d.id] = {
    solid: d.render === 'opaque' || d.render === 'cutout',
    emissive: 0,
    light: 0,
    sway: 0,
    hardness: 0.35,
    particle: 0x888888,
    replaceable: false,
    category: null,
    ...d,
  } as BlockDef;
}

def({ id: B.AIR, key: 'air', nameZh: '空气', render: 'none', tiles: t('stone'), solid: false, replaceable: true });
def({ id: B.GRASS, key: 'grass', nameZh: '草方块', render: 'opaque', tiles: t('grass_top', 'grass_side', 'dirt'), hardness: 0.3, particle: 0x6aa84f, category: 'nature' });
def({ id: B.DIRT, key: 'dirt', nameZh: '泥土', render: 'opaque', tiles: t('dirt'), hardness: 0.28, particle: 0x8a5a35, category: 'nature' });
def({ id: B.STONE, key: 'stone', nameZh: '石头', render: 'opaque', tiles: t('stone'), hardness: 0.6, particle: 0x8c8c8c, category: 'build' });
def({ id: B.SAND, key: 'sand', nameZh: '沙子', render: 'opaque', tiles: t('sand'), hardness: 0.25, particle: 0xe3d39a, category: 'nature' });
def({ id: B.LOG, key: 'oak_log', nameZh: '橡木原木', render: 'opaque', tiles: t('oak_log_top', 'oak_log', 'oak_log_top'), hardness: 0.5, particle: 0x6b4a2b, category: 'nature' });
def({ id: B.PLANKS, key: 'oak_planks', nameZh: '橡木木板', render: 'opaque', tiles: t('oak_planks'), hardness: 0.45, particle: 0xb88a52, category: 'build' });
def({ id: B.GLASS, key: 'glass', nameZh: '玻璃', render: 'cutout', tiles: t('glass'), hardness: 0.2, particle: 0xd6f0ff, category: 'build' });
def({ id: B.GLOWSTONE, key: 'glowstone', nameZh: '荧石', render: 'opaque', tiles: t('glowstone'), emissive: 1.7, light: 15, hardness: 0.3, particle: 0xffd27a, category: 'light' });
def({ id: B.SNOW, key: 'snow', nameZh: '雪块', render: 'opaque', tiles: t('snow'), hardness: 0.2, particle: 0xf4f8ff, category: 'nature' });
def({ id: B.LEAVES, key: 'leaves', nameZh: '树叶', render: 'cutout', tiles: t('leaves'), sway: 0.6, hardness: 0.12, particle: 0x4c8a32, category: 'nature' });
def({ id: B.WATER, key: 'water', nameZh: '水', render: 'water', tiles: t('water'), solid: false, replaceable: true, particle: 0x3a7bd5 });
def({ id: B.FLOWER_RED, key: 'flower_red', nameZh: '虞美人', render: 'cross', tiles: t('flower_red'), solid: false, sway: 1, hardness: 0.02, particle: 0xd8302f, replaceable: true, category: 'nature' });
def({ id: B.FLOWER_YELLOW, key: 'flower_yellow', nameZh: '蒲公英', render: 'cross', tiles: t('flower_yellow'), solid: false, sway: 1, hardness: 0.02, particle: 0xf2d12e, replaceable: true, category: 'nature' });
def({ id: B.TALL_GRASS, key: 'tall_grass', nameZh: '草丛', render: 'cross', tiles: t('tall_grass'), solid: false, sway: 1, hardness: 0.02, particle: 0x5d9e3c, replaceable: true, category: 'nature' });
def({ id: B.BEDROCK, key: 'bedrock', nameZh: '基岩', render: 'opaque', tiles: t('bedrock'), hardness: Infinity, particle: 0x333333 });
def({ id: B.GOLD, key: 'gold_block', nameZh: '金块', render: 'opaque', tiles: t('gold'), hardness: 0.6, particle: 0xf5c542, emissive: 0.08, category: 'decor' });
def({ id: B.GRAVEL, key: 'gravel', nameZh: '沙砾', render: 'opaque', tiles: t('gravel'), hardness: 0.3, particle: 0x7d7672, category: 'nature' });
def({ id: B.COBBLESTONE, key: 'cobblestone', nameZh: '圆石', render: 'opaque', tiles: t('cobblestone'), hardness: 0.6, particle: 0x7a7a7a, category: 'build' });
def({ id: B.BRICKS, key: 'bricks', nameZh: '红砖', render: 'opaque', tiles: t('bricks'), hardness: 0.6, particle: 0x9a4a3a, category: 'build' });
def({ id: B.STONE_BRICKS, key: 'stone_bricks', nameZh: '石砖', render: 'opaque', tiles: t('stone_bricks'), hardness: 0.6, particle: 0x7b7b7b, category: 'build' });
def({ id: B.BIRCH_PLANKS, key: 'birch_planks', nameZh: '白桦木板', render: 'opaque', tiles: t('birch_planks'), hardness: 0.45, particle: 0xd8c690, category: 'build' });
def({ id: B.SPRUCE_PLANKS, key: 'spruce_planks', nameZh: '云杉木板', render: 'opaque', tiles: t('spruce_planks'), hardness: 0.45, particle: 0x66482c, category: 'build' });
def({ id: B.BIRCH_LOG, key: 'birch_log', nameZh: '白桦原木', render: 'opaque', tiles: t('birch_log_top', 'birch_log', 'birch_log_top'), hardness: 0.5, particle: 0xe2ddd2, category: 'nature' });
def({ id: B.SPRUCE_LOG, key: 'spruce_log', nameZh: '云杉原木', render: 'opaque', tiles: t('spruce_log_top', 'spruce_log', 'spruce_log_top'), hardness: 0.5, particle: 0x3a2816, category: 'nature' });
def({ id: B.SANDSTONE, key: 'sandstone', nameZh: '砂岩', render: 'opaque', tiles: t('sandstone_top', 'sandstone', 'sandstone_top'), hardness: 0.45, particle: 0xdcc890, category: 'build' });
def({ id: B.CLAY, key: 'clay', nameZh: '黏土块', render: 'opaque', tiles: t('clay'), hardness: 0.3, particle: 0x9aa1b0, category: 'nature' });
def({ id: B.ICE, key: 'ice', nameZh: '冰', render: 'opaque', tiles: t('ice'), hardness: 0.25, particle: 0xa8c8ff, category: 'nature' });
def({ id: B.QUARTZ, key: 'quartz', nameZh: '石英块', render: 'opaque', tiles: t('quartz'), hardness: 0.5, particle: 0xf0ece4, category: 'build' });
def({ id: B.BOOKSHELF, key: 'bookshelf', nameZh: '书架', render: 'opaque', tiles: t('oak_planks', 'bookshelf', 'oak_planks'), hardness: 0.4, particle: 0x8a5a35, category: 'build' });
def({ id: B.IRON, key: 'iron_block', nameZh: '铁块', render: 'opaque', tiles: t('iron'), hardness: 0.7, particle: 0xd0d2d6, category: 'decor' });
def({ id: B.DIAMOND, key: 'diamond_block', nameZh: '钻石块', render: 'opaque', tiles: t('diamond'), hardness: 0.8, particle: 0x6ee0d8, emissive: 0.05, category: 'decor' });
def({ id: B.WOOL_WHITE, key: 'wool_white', nameZh: '白色羊毛', render: 'opaque', tiles: t('wool_white'), hardness: 0.15, particle: 0xeeeeee, category: 'decor' });
def({ id: B.WOOL_RED, key: 'wool_red', nameZh: '红色羊毛', render: 'opaque', tiles: t('wool_red'), hardness: 0.15, particle: 0xb02e26, category: 'decor' });
def({ id: B.WOOL_YELLOW, key: 'wool_yellow', nameZh: '黄色羊毛', render: 'opaque', tiles: t('wool_yellow'), hardness: 0.15, particle: 0xf2c42c, category: 'decor' });
def({ id: B.WOOL_BLUE, key: 'wool_blue', nameZh: '蓝色羊毛', render: 'opaque', tiles: t('wool_blue'), hardness: 0.15, particle: 0x3c44aa, category: 'decor' });
def({ id: B.WOOL_GREEN, key: 'wool_green', nameZh: '绿色羊毛', render: 'opaque', tiles: t('wool_green'), hardness: 0.15, particle: 0x5e9c22, category: 'decor' });
def({ id: B.WOOL_BLACK, key: 'wool_black', nameZh: '黑色羊毛', render: 'opaque', tiles: t('wool_black'), hardness: 0.15, particle: 0x2a2a30, category: 'decor' });
def({ id: B.SEA_LANTERN, key: 'sea_lantern', nameZh: '海晶灯', render: 'opaque', tiles: t('sea_lantern'), emissive: 1.5, light: 15, hardness: 0.3, particle: 0xc8f0ea, category: 'light' });
def({ id: B.LANTERN, key: 'lantern', nameZh: '灯笼', render: 'opaque', tiles: t('lantern'), emissive: 1.6, light: 14, hardness: 0.35, particle: 0xffb060, category: 'light' });
def({ id: B.REDSTONE_LAMP, key: 'redstone_lamp', nameZh: '红石灯', render: 'opaque', tiles: t('redstone_lamp'), emissive: 1.4, light: 15, hardness: 0.3, particle: 0xffa040, category: 'light' });

export const BLOCKS: readonly BlockDef[] = defs;
export const BLOCK_COUNT = defs.length;

/** 快捷查询表（Typed array，供网格化器热循环使用） */
export const IS_OPAQUE = new Uint8Array(256);
export const IS_SOLID = new Uint8Array(256);
export const RENDER_KIND = new Uint8Array(256); // 0 none 1 opaque 2 cutout 3 cross 4 water
export const LIGHT_EMIT = new Uint8Array(256);
const KIND_CODE: Record<RenderKind, number> = { none: 0, opaque: 1, cutout: 2, cross: 3, water: 4 };
for (const d of defs) {
  IS_OPAQUE[d.id] = d.render === 'opaque' ? 1 : 0;
  IS_SOLID[d.id] = d.solid ? 1 : 0;
  RENDER_KIND[d.id] = KIND_CODE[d.render];
  LIGHT_EMIT[d.id] = d.light;
}

/** 创造物品栏中可选的方块（按分类） */
export function blocksIn(cat: Category): BlockDef[] {
  return defs.filter((d) => d && d.category === cat);
}

/** 默认物品栏 */
export const DEFAULT_HOTBAR: number[] = [B.GRASS, B.DIRT, B.STONE, B.COBBLESTONE, B.PLANKS, B.LOG, B.GLASS, B.GLOWSTONE, B.LANTERN];
