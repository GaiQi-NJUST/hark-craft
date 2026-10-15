import { useState } from 'react';
import { useGame, QUALITY_LABEL, INTERACT_LABEL, BUTTON_LABEL, type ButtonSize } from '../store';
import type { Engine } from '../engine/Engine';
import { TEX_LABEL } from '../world/BlockTextures';
import { synth } from '../audio/Synth';

const SIZES: ButtonSize[] = ['small', 'medium', 'large'];

export function PauseMenu({ engine }: { engine: Engine | null }) {
  const quality = useGame((s) => s.quality);
  const cycleQuality = useGame((s) => s.cycleQuality);
  const texRes = useGame((s) => s.texRes);
  const cycleTexRes = useGame((s) => s.cycleTexRes);
  const texProgress = useGame((s) => s.texProgress);
  const mode = useGame((s) => s.interactMode);
  const setMode = useGame((s) => s.setInteractMode);
  const size = useGame((s) => s.buttonSize);
  const setSize = useGame((s) => s.setButtonSize);
  const isTouch = useGame((s) => s.isTouch);
  const setShowHelp = useGame((s) => s.setShowHelp);
  const muted = useGame((s) => s.muted);
  const setMuted = useGame((s) => s.setMuted);
  const seed = useGame((s) => s.worldSeed);
  const [confirm, setConfirm] = useState(false);
  const [tab, setTab] = useState<'main' | 'settings'>('main');
  const click = () => synth.pop('ui');

  return (
    <div className="pause-screen">
      <div className="glass-panel pause-panel">
        <h2 className="panel-title">{tab === 'main' ? '游戏暂停' : '设置'}</h2>
        {tab === 'main' ? (
          <>
            <button className="block-btn primary" onClick={() => engine?.resume()}>
              继续
            </button>
            <button className="block-btn" onClick={() => { click(); setTab('settings'); }}>
              设置（画质 · 材质包 · 操作）
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
          </>
        ) : (
          <>
            <div className="set-row">
              <span className="set-label">画质</span>
              <button className="block-btn small" onClick={() => { click(); cycleQuality(); }}>
                {QUALITY_LABEL[quality]}
              </button>
            </div>
            <div className="set-row">
              <span className="set-label">材质包</span>
              <button className="block-btn small" onClick={() => { click(); cycleTexRes(); }}>
                {TEX_LABEL[texRes]}
                {texProgress < 1 ? ` · ${Math.round(texProgress * 100)}%` : ''}
              </button>
            </div>
            <div className="set-row">
              <span className="set-label">触屏交互</span>
              <div className="seg">
                {(['tap', 'crosshair'] as const).map((m) => (
                  <button key={m} className={'seg-btn' + (mode === m ? ' on' : '')} onClick={() => { click(); setMode(m); }}>
                    {INTERACT_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
            <div className="set-row">
              <span className="set-label">按钮大小</span>
              <div className="seg">
                {SIZES.map((z) => (
                  <button key={z} className={'seg-btn' + (size === z ? ' on' : '')} onClick={() => { click(); setSize(z); }}>
                    {BUTTON_LABEL[z]}
                  </button>
                ))}
              </div>
            </div>
            <p className="set-note">
              {isTouch ? '点击交互：点按放置、长按破坏（基岩版默认）。准星模式：屏幕中心准星 + 右侧「挖 / 放」按钮。' : '触屏设置仅在手机 / 平板上生效。'}
              高清材质在手机上建议 128x；内存紧张可选 64x 或像素 16x。
            </p>
            <button className="block-btn primary" onClick={() => { click(); setTab('main'); }}>
              返回
            </button>
          </>
        )}
        <div className="pause-seed">世界种子 · {seed} · v1.1.0</div>
      </div>
    </div>
  );
}
