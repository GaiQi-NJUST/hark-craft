import type { Engine } from '../engine/Engine';

/** 开场动画的字幕层（时间轴与 SplashScene 对齐），点击/按键可跳过 */
export function SplashOverlay({ engine }: { engine: Engine | null }) {
  return (
    <div className="splash-overlay" onPointerDown={() => engine?.skipIntro()}>
      <div className="splash-subtitle">
        <span className="splash-sub-main">由 Hark 打造</span>
        <span className="splash-sub-dot">·</span>
        <span className="splash-sub-second">一个方块构成的世界</span>
      </div>
      <div className="splash-skip">点击或按任意键跳过 ▸</div>
    </div>
  );
}
