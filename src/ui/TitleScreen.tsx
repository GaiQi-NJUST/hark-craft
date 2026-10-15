import { useGame, QUALITY_LABEL } from '../store';
import type { Engine } from '../engine/Engine';
import { BlockLogo } from './BlockLogo';
import { synth } from '../audio/Synth';

export function TitleScreen({ engine }: { engine: Engine | null }) {
  const quality = useGame((s) => s.quality);
  const cycleQuality = useGame((s) => s.cycleQuality);
  const setShowHelp = useGame((s) => s.setShowHelp);

  return (
    <div className="title-screen">
      <div className="title-center">
        <div className="logo-wrap">
          <BlockLogo text="HARK CRAFT" pixel={12} />
          <div className="logo-tagline">一个方块构成的世界</div>
        </div>
        <div className="menu">
          <button className="block-btn primary" onClick={() => engine?.startGame()}>
            开始游戏
          </button>
          <button
            className="block-btn"
            onClick={() => {
              synth.unlock();
              synth.pop('ui');
              cycleQuality();
            }}
          >
            画质：{QUALITY_LABEL[quality]}
          </button>
          <button
            className="block-btn"
            onClick={() => {
              synth.unlock();
              synth.pop('ui');
              setShowHelp(true);
            }}
          >
            操作说明
          </button>
        </div>
      </div>
      <div className="corner-credit">Made by Hark</div>
      <div className="corner-version">v1.0 · 体素沙盒</div>
    </div>
  );
}
