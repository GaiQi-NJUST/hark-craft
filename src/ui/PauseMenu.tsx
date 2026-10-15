import { useState } from 'react';
import { useGame, QUALITY_LABEL } from '../store';
import type { Engine } from '../engine/Engine';
import { synth } from '../audio/Synth';

export function PauseMenu({ engine }: { engine: Engine | null }) {
  const quality = useGame((s) => s.quality);
  const cycleQuality = useGame((s) => s.cycleQuality);
  const setShowHelp = useGame((s) => s.setShowHelp);
  const muted = useGame((s) => s.muted);
  const setMuted = useGame((s) => s.setMuted);
  const seed = useGame((s) => s.worldSeed);
  const [confirm, setConfirm] = useState(false);
  const click = () => synth.pop('ui');

  return (
    <div className="pause-screen">
      <div className="glass-panel pause-panel">
        <h2 className="panel-title">游戏暂停</h2>
        <button className="block-btn primary" onClick={() => engine?.resume()}>
          继续
        </button>
        <button className="block-btn" onClick={() => { click(); cycleQuality(); }}>
          画质：{QUALITY_LABEL[quality]}
        </button>
        {!confirm ? (
          <button className="block-btn" onClick={() => { click(); setConfirm(true); }}>
            重新生成世界
          </button>
        ) : (
          <div className="confirm-row">
            <button className="block-btn danger" onClick={() => { click(); setConfirm(false); engine?.regenerateWorld(); }}>
              确定（当前建造将丢失）
            </button>
            <button className="block-btn small" onClick={() => setConfirm(false)}>
              取消
            </button>
          </div>
        )}
        <button className="block-btn" onClick={() => { click(); engine?.replayIntro(); }}>
          观看开场动画
        </button>
        <div className="pause-row">
          <button className="block-btn small" onClick={() => { click(); setShowHelp(true); }}>
            操作说明
          </button>
          <button className="block-btn small" onClick={() => setMuted(!muted)}>
            声音：{muted ? '关' : '开'}
          </button>
        </div>
        <div className="pause-seed">世界种子 · {seed}</div>
      </div>
    </div>
  );
}
