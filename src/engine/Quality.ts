import type { QualityTier } from '../store';
import type { TexRes } from '../world/BlockTextures';

/** 画质分档：控制 SSAO、阴影、渲染距离、像素比、后处理、云层与环境反射 */
export interface QualitySettings {
  tier: QualityTier;
  ssao: boolean;
  shadowMapSize: number;
  /** 阴影相机半宽（方块） */
  shadowExtent: number;
  /** PCSS 接触硬化软阴影 */
  pcss: boolean;
  renderDistance: number;
  /** 像素比上限（自适应分辨率在其下浮动） */
  pixelRatio: number;
  /** 自适应分辨率下限 */
  minPixelRatio: number;
  godRays: boolean;
  bloom: boolean;
  godRaySamples: number;
  /** 抗锯齿后处理 */
  aa: 'smaa' | 'fxaa' | 'none';
  /** 云层 fBm 倍频数（0 = 关闭） */
  cloudOctaves: number;
  /** 天空环境光照（PMREM）更新间隔（游戏内一天的比例） */
  envStep: number;
  /** 每帧区块生成预算（毫秒） */
  genBudgetMs: number;
  particles: number;
  /** 该档默认材质包分辨率 */
  defaultTex: TexRes;
}

export function getQuality(tier: QualityTier): QualitySettings {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  switch (tier) {
    case 'high':
      return {
        tier, ssao: true, shadowMapSize: 4096, shadowExtent: 56, pcss: true, renderDistance: 8,
        pixelRatio: Math.min(dpr, 2), minPixelRatio: Math.min(dpr, 1), godRays: true, bloom: true, godRaySamples: 60,
        aa: 'smaa', cloudOctaves: 5, envStep: 0.004, genBudgetMs: 7, particles: 1, defaultTex: 256,
      };
    case 'medium':
      return {
        tier, ssao: false, shadowMapSize: 2048, shadowExtent: 40, pcss: false, renderDistance: 5,
        pixelRatio: Math.min(dpr, 1.5), minPixelRatio: Math.min(dpr, 0.85), godRays: true, bloom: true, godRaySamples: 36,
        aa: 'fxaa', cloudOctaves: 4, envStep: 0.008, genBudgetMs: 6, particles: 0.7, defaultTex: 128,
      };
    default:
      return {
        tier, ssao: false, shadowMapSize: 1024, shadowExtent: 32, pcss: false, renderDistance: 4,
        pixelRatio: Math.min(dpr, 1), minPixelRatio: Math.min(dpr, 0.7), godRays: false, bloom: true, godRaySamples: 24,
        aa: 'none', cloudOctaves: 3, envStep: 0.02, genBudgetMs: 5, particles: 0.4, defaultTex: 64,
      };
  }
}
