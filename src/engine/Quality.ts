import type { QualityTier } from '../store';

/** 画质分档：控制 SSAO、阴影贴图尺寸、渲染距离、像素比与后处理 */
export interface QualitySettings {
  tier: QualityTier;
  ssao: boolean;
  shadowMapSize: number;
  /** 阴影相机半宽（方块） */
  shadowExtent: number;
  renderDistance: number;
  pixelRatio: number;
  godRays: boolean;
  bloom: boolean;
  godRaySamples: number;
  /** 每帧区块生成预算（毫秒） */
  genBudgetMs: number;
  particles: number;
}

export function getQuality(tier: QualityTier): QualitySettings {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  switch (tier) {
    case 'high':
      return {
        tier, ssao: true, shadowMapSize: 4096, shadowExtent: 56, renderDistance: 8,
        pixelRatio: Math.min(dpr, 2), godRays: true, bloom: true, godRaySamples: 60,
        genBudgetMs: 7, particles: 1,
      };
    case 'medium':
      return {
        tier, ssao: false, shadowMapSize: 2048, shadowExtent: 44, renderDistance: 6,
        pixelRatio: Math.min(dpr, 1.5), godRays: true, bloom: true, godRaySamples: 40,
        genBudgetMs: 6, particles: 0.7,
      };
    default:
      return {
        tier, ssao: false, shadowMapSize: 2048, shadowExtent: 32, renderDistance: 4,
        pixelRatio: Math.min(dpr, 1), godRays: false, bloom: true, godRaySamples: 24,
        genBudgetMs: 5, particles: 0.4,
      };
  }
}
