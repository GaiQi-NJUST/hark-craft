import { create } from 'zustand';

/** 场景状态机：splash → title → playing ⇄ paused */
export type SceneState = 'splash' | 'title' | 'playing' | 'paused';
export type QualityTier = 'high' | 'medium' | 'low';

export const QUALITY_LABEL: Record<QualityTier, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export const isTouchDevice = (): boolean =>
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
  window.matchMedia?.('(pointer: coarse)').matches === true;

function initialQuality(): QualityTier {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'high' || q === 'medium' || q === 'low') return q;
  return isTouchDevice() ? 'low' : 'high';
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
}

export interface GameState {
  scene: SceneState;
  quality: QualityTier;
  selectedSlot: number;
  /** 0..1，0 = 日出 */
  timeOfDay: number;
  showDebug: boolean;
  showHelp: boolean;
  muted: boolean;
  isTouch: boolean;
  pointerLockSupported: boolean;
  /** 进入游戏的过渡动画进行中 */
  entering: boolean;
  toast: { text: string; id: number } | null;
  debug: DebugInfo;
  worldSeed: number;

  setScene: (s: SceneState) => void;
  setQuality: (q: QualityTier) => void;
  cycleQuality: () => void;
  setSlot: (i: number) => void;
  setTime: (t: number) => void;
  toggleDebug: () => void;
  setShowHelp: (v: boolean) => void;
  setMuted: (v: boolean) => void;
  setEntering: (v: boolean) => void;
  showToast: (text: string) => void;
  setDebug: (d: DebugInfo) => void;
  setSeed: (s: number) => void;
  setPointerLockSupported: (v: boolean) => void;
}

const ORDER: QualityTier[] = ['high', 'medium', 'low'];

export const useGame = create<GameState>((set, get) => ({
  scene: 'splash',
  quality: initialQuality(),
  selectedSlot: 0,
  timeOfDay: 0.035,
  showDebug: false,
  showHelp: false,
  muted: false,
  isTouch: isTouchDevice(),
  pointerLockSupported: typeof document !== 'undefined' && 'pointerLockElement' in document,
  entering: false,
  toast: null,
  debug: { fps: 0, x: 0, y: 0, z: 0, chunks: 0, drawCalls: 0, triangles: 0, facing: '', flying: false },
  worldSeed: Number(new URLSearchParams(location.search).get('seed')) || Math.floor(Math.random() * 1e9),

  setScene: (scene) => set({ scene }),
  setQuality: (quality) => set({ quality }),
  cycleQuality: () => {
    const i = ORDER.indexOf(get().quality);
    set({ quality: ORDER[(i + 1) % ORDER.length] });
  },
  setSlot: (i) => set({ selectedSlot: ((i % 9) + 9) % 9 }),
  setTime: (timeOfDay) => set({ timeOfDay }),
  toggleDebug: () => set({ showDebug: !get().showDebug }),
  setShowHelp: (showHelp) => set({ showHelp }),
  setMuted: (muted) => set({ muted }),
  setEntering: (entering) => set({ entering }),
  showToast: (text) => set({ toast: { text, id: Date.now() + Math.random() } }),
  setDebug: (debug) => set({ debug }),
  setSeed: (worldSeed) => set({ worldSeed }),
  setPointerLockSupported: (pointerLockSupported) => set({ pointerLockSupported }),
}));
