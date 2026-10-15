import { useEffect, useRef, useState } from 'react';
import { useGame } from './store';
import { Engine } from './engine/Engine';
import { SplashOverlay } from './ui/SplashOverlay';
import { TitleScreen } from './ui/TitleScreen';
import { HUD } from './ui/HUD';
import { PauseMenu } from './ui/PauseMenu';
import { TouchControls } from './ui/TouchControls';
import { HelpPanel } from './ui/HelpPanel';
import { Inventory } from './ui/Inventory';

/**
 * 场景状态机：splash → title → playing ⇄ paused
 * 3D 由 Engine 驱动；React 只负责 UI 层，通过 zustand store 同步状态。
 */
export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scene = useGame((s) => s.scene);
  const isTouch = useGame((s) => s.isTouch);
  const entering = useGame((s) => s.entering);

  useEffect(() => {
    if (!host.current) return;
    let e: Engine | null = null;
    try {
      e = new Engine(host.current);
      setEngine(e);
    } catch (err) {
      console.error(err);
      setError('无法初始化 WebGL，请使用支持 WebGL2 的现代浏览器。');
    }
    return () => e?.dispose();
  }, []);

  return (
    <div className={`app scene-${scene}`}>
      <div className="canvas-host" ref={host} />
      {error && <div className="fatal glass-panel">{error}</div>}
      <div className={'layer fade-layer' + (scene === 'splash' ? ' on' : '')}>{scene === 'splash' && <SplashOverlay engine={engine} />}</div>
      <div className={'layer fade-layer' + (scene === 'title' ? ' on' : '')}>{scene === 'title' && <TitleScreen engine={engine} />}</div>
      <HUD engine={engine} />
      {isTouch && scene === 'playing' && !entering && <TouchControls engine={engine} />}
      {scene === 'playing' && <Inventory />}
      <div className={'layer fade-layer' + (scene === 'paused' ? ' on' : '')}>{scene === 'paused' && <PauseMenu engine={engine} />}</div>
      <HelpPanel />
    </div>
  );
}
