import { create } from 'zustand';
import { DEFAULT_HOTBAR, BLOCKS } from './world/Blocks';
import type { TexRes } from './world/BlockTextures';

/** 场景状态机：splash → title → playing ⇄ paused */
export type SceneState = 'splash' | 'title' | 'playing' | 'paused';
export type QualityTier = 'high' | 'medium' | 'low';
/** 触屏交互：点击交互（基岩版默认：点按放置、长按破坏）/ 准星模式（准星 + 挖/放按钮） */
export type InteractMode = 'tap' | 'crosshair';
export type ButtonSize = 'small' | 'medium' | 'large';

export const QUALITY_LABEL: Record<QualityTier, string> = { high: '高', medium: '中', low: '低' };
export const INTERACT_LABEL: Record<InteractMode, string> = { tap: '点击交互', crosshair: '准星模式' };
export const BUTTON_LABEL: Record<ButtonSize, string> = { small: '小', medium: '中', large: '大' };
export const BUTTON_SCALE: Record<ButtonSize, number> = { small: 0.85, medium: 1, large: 1.2 };

export const isTouchDevice = (): boolean =>
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
  window.matchMedia?.('(pointer: coarse)').matches === true;

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

// ───────── 本地存储（任何异常都忽略：隐私模式 / file:// / WebView 限制） ─────────
const STORE_KEY = 'hark-craft-v1.1';
interface Saved {
  hotbar?: number[];
  quality?: QualityTier;
  tex?: TexRes;
  interact?: InteractMode;
  buttons?: ButtonSize;
  muted?: boolean;
}
function load(): Saved {
  try {
    const raw = window.localStorage?.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : {};
  } catch {
    return {};
  }
}
function save(s: Saved) {
  try {
    window.localStorage?.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* 忽略 */
  }
}
const saved = typeof window !== 'undefined' && !params.has('fresh') ? load() : {};

function initialQuality(): QualityTier {
  const q = params.get('quality');
  if (q === 'high' || q === 'medium' || q === 'low') return q;
  if (saved.quality) return saved.quality;
  // 手机默认「中」：128x 材质、2048 阴影、无 SSAO
  return isTouchDevice() ? 'medium' : 'high';
}

const TIER_TEX: Record<QualityTier, TexRes> = { high: 256, medium: 128, low: 64 };
function initialTex(q: QualityTier): TexRes {
  const t = Number(params.get('tex'));
  if (t === 16 || t === 64 || t === 128 || t === 256) return t;
  if (saved.tex) return saved.tex;
  return TIER_TEX[q];
}

function initialInteract(): InteractMode {
  const m = params.get('interact');
  if (m === 'tap' || m === 'crosshair') return m;
  return saved.interact ?? 'tap';
}

function validHotbar(h: unknown): number[] | null {
  if (!Array.isArray(h) || h.length !== 9) return null;
  return h.every((id) => typeof id === 'number' && BLOCKS[id] && BLOCKS[id].category) ? (h as number[]) : null;
}

export interface DebugInfo {
  fps: number;
  x: number;
  y: number;
  z: number;
  chunks: number;
  drawCalls: number;
  triangles: number;
  facing: string;
  flying: boolean;
  pixelRatio: number;
  tex: string;
}

export interface GameState {
  scene: SceneState;
  quality: QualityTier;
  texRes: TexRes;
  interactMode: InteractMode;
  buttonSize: ButtonSize;
  selectedSlot: number;
  hotbar: number[];
  inventoryOpen: boolean;
  /** 0..1，0 = 日出 */
  timeOfDay: number;
  showDebug: boolean;
  showHelp: boolean;
  muted: boolean;
  isTouch: boolean;
  flying: boolean;
  sneaking: boolean;
  pointerLockSupported: boolean;
  /** 进入游戏的过渡动画进行中 */
  entering: boolean;
  toast: { text: string; id: number } | null;
  debug: DebugInfo;
  worldSeed: number;
  /** 材质包生成进度 0..1（1 = 完成） */
  texProgress: number;
  /** 材质包版本（图标刷新用） */
  texVersion: number;

  setScene: (s: SceneState) => void;
  setQuality: (q: QualityTier) => void;
  cycleQuality: () => void;
  setTexRes: (t: TexRes) => void;
  cycleTexRes: () => void;
  setInteractMode: (m: InteractMode) => void;
  setButtonSize: (b: ButtonSize) => void;
  setSlot: (i: number) => void;
  setHotbarSlot: (slot: number, id: number) => void;
  swapHotbar: (a: number, b: number) => void;
  setInventoryOpen: (v: boolean) => void;
  setTime: (t: number) => void;
  toggleDebug: () => void;
  setShowHelp: (v: boolean) => void;
  setMuted: (v: boolean) => void;
  setFlying: (v: boolean) => void;
  setSneaking: (v: boolean) => void;
  setEntering: (v: boolean) => void;
  showToast: (text: string) => void;
  setDebug: (d: DebugInfo) => void;
  setSeed: (s: number) => void;
  setPointerLockSupported: (v: boolean) => void;
  setTexProgress: (p: number, version?: number) => void;
}

const ORDER: QualityTier[] = ['high', 'medium', 'low'];
const TEX_ORDER: TexRes[] = [256, 128, 64, 16];

const q0 = initialQuality();

export const useGame = create<GameState>((set, get) => ({
  scene: 'splash',
  quality: q0,
  texRes: initialTex(q0),
  interactMode: initialInteract(),
  buttonSize: saved.buttons ?? 'medium',
  selectedSlot: 0,
  hotbar: validHotbar(saved.hotbar) ?? [...DEFAULT_HOTBAR],
  inventoryOpen: false,
  timeOfDay: 0.035,
  showDebug: false,
  showHelp: false,
  muted: saved.muted ?? false,
  isTouch: isTouchDevice(),
  flying: false,
  sneaking: false,
  pointerLockSupported: typeof document !== 'undefined' && 'pointerLockElement' in document,
  entering: false,
  toast: null,
  debug: { fps: 0, x: 0, y: 0, z: 0, chunks: 0, drawCalls: 0, triangles: 0, facing: '', flying: false, pixelRatio: 1, tex: '' },
  worldSeed: Number(params.get('seed')) || Math.floor(Math.random() * 1e9),
  texProgress: 1,
  texVersion: 0,

  setScene: (scene) => set({ scene }),
  setQuality: (quality) => set({ quality }),
  cycleQuality: () => {
    const i = ORDER.indexOf(get().quality);
    set({ quality: ORDER[(i + 1) % ORDER.length] });
  },
  setTexRes: (texRes) => set({ texRes }),
  cycleTexRes: () => {
    const i = TEX_ORDER.indexOf(get().texRes);
    set({ texRes: TEX_ORDER[(i + 1) % TEX_ORDER.length] });
  },
  setInteractMode: (interactMode) => set({ interactMode }),
  setButtonSize: (buttonSize) => set({ buttonSize }),
  setSlot: (i) => set({ selectedSlot: ((Math.round(i) % 9) + 9) % 9 }),
  setHotbarSlot: (slot, id) => {
    const hotbar = [...get().hotbar];
    hotbar[slot] = id;
    set({ hotbar });
  },
  swapHotbar: (a, b) => {
    const hotbar = [...get().hotbar];
    [hotbar[a], hotbar[b]] = [hotbar[b], hotbar[a]];
    set({ hotbar });
  },
  setInventoryOpen: (inventoryOpen) => set({ inventoryOpen }),
  setTime: (timeOfDay) => set({ timeOfDay }),
  toggleDebug: () => set({ showDebug: !get().showDebug }),
  setShowHelp: (showHelp) => set({ showHelp }),
  setMuted: (muted) => set({ muted }),
  setFlying: (flying) => set({ flying }),
  setSneaking: (sneaking) => set({ sneaking }),
  setEntering: (entering) => set({ entering }),
  showToast: (text) => set({ toast: { text, id: Date.now() + Math.random() } }),
  setDebug: (debug) => set({ debug }),
  setSeed: (worldSeed) => set({ worldSeed }),
  setPointerLockSupported: (pointerLockSupported) => set({ pointerLockSupported }),
  setTexProgress: (texProgress, version) => set(version !== undefined ? { texProgress, texVersion: version } : { texProgress }),
}));

// 设置与物品栏变化时写入本地存储
useGame.subscribe((s, p) => {
  if (
    s.hotbar !== p.hotbar || s.quality !== p.quality || s.texRes !== p.texRes ||
    s.interactMode !== p.interactMode || s.buttonSize !== p.buttonSize || s.muted !== p.muted
  ) {
    save({ hotbar: s.hotbar, quality: s.quality, tex: s.texRes, interact: s.interactMode, buttons: s.buttonSize, muted: s.muted });
  }
});
