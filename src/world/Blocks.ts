/** 方块注册表：所有方块的渲染/物理/贴图属性集中定义于此 */

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
} as const;

/** opaque: 实心不透明立方体；cutout: alpha 测试立方体（树叶/玻璃）；cross: 十字交叉植物；water: 水；none: 空气 */
export type RenderKind = 'none' | 'opaque' | 'cutout' | 'cross' | 'water';

/** 贴图名称（TextureAtlas 中生成） */
export type TileName =
  | 'grass_top' | 'grass_side' | 'dirt' | 'stone' | 'sand' | 'log_side' | 'log_top'
  | 'planks' | 'glass' | 'glowstone' | 'snow' | 'leaves' | 'water' | 'flower_red'
  | 'flower_yellow' | 'tall_grass' | 'bedrock' | 'gold' | 'gravel';

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
  /** 随风摆动强度 */
  sway: number;
  /** 破坏所需秒数 */
  hardness: number;
  /** 破坏粒子颜色 */
  particle: number;
  /** 是否可被放置覆盖（水、草丛、花） */
  replaceable: boolean;
}

const t = (top: TileName, side: TileName = top, bottom: TileName = top) => ({ top, side, bottom });

const defs: BlockDef[] = [];
function def(d: Partial<BlockDef> & Pick<BlockDef, 'id' | 'key' | 'nameZh' | 'render' | 'tiles'>) {
  defs[d.id] = {
    solid: d.render === 'opaque' || d.render === 'cutout',
    emissive: 0,
    sway: 0,
    hardness: 0.35,
    particle: 0x888888,
    replaceable: false,
    ...d,
  } as BlockDef;
}

def({ id: B.AIR, key: 'air', nameZh: '空气', render: 'none', tiles: t('stone'), solid: false, replaceable: true });
def({ id: B.GRASS, key: 'grass', nameZh: '草方块', render: 'opaque', tiles: t('grass_top', 'grass_side', 'dirt'), hardness: 0.3, particle: 0x6aa84f });
def({ id: B.DIRT, key: 'dirt', nameZh: '泥土', render: 'opaque', tiles: t('dirt'), hardness: 0.28, particle: 0x8a5a35 });
def({ id: B.STONE, key: 'stone', nameZh: '石头', render: 'opaque', tiles: t('stone'), hardness: 0.6, particle: 0x8c8c8c });
def({ id: B.SAND, key: 'sand', nameZh: '沙子', render: 'opaque', tiles: t('sand'), hardness: 0.25, particle: 0xe3d39a });
def({ id: B.LOG, key: 'log', nameZh: '原木', render: 'opaque', tiles: t('log_top', 'log_side', 'log_top'), hardness: 0.5, particle: 0x6b4a2b });
def({ id: B.PLANKS, key: 'planks', nameZh: '木板', render: 'opaque', tiles: t('planks'), hardness: 0.45, particle: 0xb88a52 });
def({ id: B.GLASS, key: 'glass', nameZh: '玻璃', render: 'cutout', tiles: t('glass'), hardness: 0.2, particle: 0xd6f0ff });
def({ id: B.GLOWSTONE, key: 'glowstone', nameZh: '荧石', render: 'opaque', tiles: t('glowstone'), emissive: 1.7, hardness: 0.3, particle: 0xffd27a });
def({ id: B.SNOW, key: 'snow', nameZh: '雪块', render: 'opaque', tiles: t('snow'), hardness: 0.2, particle: 0xf4f8ff });
def({ id: B.LEAVES, key: 'leaves', nameZh: '树叶', render: 'cutout', tiles: t('leaves'), sway: 0.6, hardness: 0.12, particle: 0x4c8a32 });
def({ id: B.WATER, key: 'water', nameZh: '水', render: 'water', tiles: t('water'), solid: false, replaceable: true, particle: 0x3a7bd5 });
def({ id: B.FLOWER_RED, key: 'flower_red', nameZh: '虞美人', render: 'cross', tiles: t('flower_red'), solid: false, sway: 1, hardness: 0.02, particle: 0xd8302f, replaceable: true });
def({ id: B.FLOWER_YELLOW, key: 'flower_yellow', nameZh: '蒲公英', render: 'cross', tiles: t('flower_yellow'), solid: false, sway: 1, hardness: 0.02, particle: 0xf2d12e, replaceable: true });
def({ id: B.TALL_GRASS, key: 'tall_grass', nameZh: '草丛', render: 'cross', tiles: t('tall_grass'), solid: false, sway: 1, hardness: 0.02, particle: 0x5d9e3c, replaceable: true });
def({ id: B.BEDROCK, key: 'bedrock', nameZh: '基岩', render: 'opaque', tiles: t('bedrock'), hardness: Infinity, particle: 0x333333 });
def({ id: B.GOLD, key: 'gold', nameZh: '金块', render: 'opaque', tiles: t('gold'), hardness: 0.6, particle: 0xf5c542, emissive: 0.15 });
def({ id: B.GRAVEL, key: 'gravel', nameZh: '沙砾', render: 'opaque', tiles: t('gravel'), hardness: 0.3, particle: 0x7d7672 });

export const BLOCKS: readonly BlockDef[] = defs;
export const BLOCK_COUNT = defs.length;

/** 快捷查询表（Typed array，供网格化器热循环使用） */
export const IS_OPAQUE = new Uint8Array(256);
export const IS_SOLID = new Uint8Array(256);
export const RENDER_KIND = new Uint8Array(256); // 0 none 1 opaque 2 cutout 3 cross 4 water
const KIND_CODE: Record<RenderKind, number> = { none: 0, opaque: 1, cutout: 2, cross: 3, water: 4 };
for (const d of defs) {
  IS_OPAQUE[d.id] = d.render === 'opaque' ? 1 : 0;
  IS_SOLID[d.id] = d.solid ? 1 : 0;
  RENDER_KIND[d.id] = KIND_CODE[d.render];
}

/** 物品栏：草、泥土、石头、沙子、原木、木板、玻璃、荧石、雪 */
export const HOTBAR: number[] = [B.GRASS, B.DIRT, B.STONE, B.SAND, B.LOG, B.PLANKS, B.GLASS, B.GLOWSTONE, B.SNOW];
