import { useEffect, useState } from 'react';
import { useGame } from '../store';
import { SkySystem } from '../engine/SkySystem';
import { Hotbar } from './Hotbar';

function TimeIndicator() {
  const t = useGame((s) => s.timeOfDay);
  const elev = Math.sin(t * Math.PI * 2);
  const isDay = elev > -0.05;
  const phase = elev > 0.35 ? '白昼' : elev > -0.05 ? (t < 0.25 ? '清晨' : '黄昏') : '夜晚';
  // 太阳/月亮在弧线上的位置
  const a = isDay ? (t % 0.5) / 0.5 : ((t - 0.5 + 1) % 1) / 0.5;
  const x = 6 + a * 52;
  const y = 30 - Math.sin(a * Math.PI) * 22;
  return (
    <div className="glass-chip time-chip">
      <svg width="64" height="34" viewBox="0 0 64 34" className="time-arc">
        <path d="M6 30 Q32 -14 58 30" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="2" strokeDasharray="3 3" />
        <rect x={x - 5} y={y - 5} width="10" height="10" fill={isDay ? '#ffd46b' : '#dfe6ff'} stroke={isDay ? '#ff9f3a' : '#9fb0e8'} strokeWidth="1.5" />
      </svg>
      <div className="time-text">
        <span className="time-clock">{SkySystem.clock(t)}</span>
        <span className="time-phase">{phase}</span>
      </div>
    </div>
  );
}

function DebugPanel() {
  const show = useGame((s) => s.showDebug);
  const d = useGame((s) => s.debug);
  const q = useGame((s) => s.quality);
  if (!show) return null;
  return (
    <div className="debug-panel">
      <div>HARK CRAFT · F3 调试</div>
      <div>FPS：{d.fps}</div>
      <div>
        坐标：{d.x.toFixed(1)} / {d.y.toFixed(1)} / {d.z.toFixed(1)}
      </div>
      <div>朝向：{d.facing}</div>
      <div>区块：{d.chunks} · 绘制调用：{d.drawCalls}</div>
      <div>三角形：{(d.triangles / 1000).toFixed(0)}k · 画质：{q}</div>
      <div>飞行：{d.flying ? '开' : '关'}</div>
    </div>
  );
}

function Toast() {
  const toast = useGame((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 2200);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  return <div className={'toast glass-chip' + (visible ? ' show' : '')}>{toast.text}</div>;
}

export function HUD() {
  const scene = useGame((s) => s.scene);
  const entering = useGame((s) => s.entering);
  const isTouch = useGame((s) => s.isTouch);
  const [tips, setTips] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setTips(false), 7000);
    return () => clearTimeout(id);
  }, []);
  const active = scene === 'playing' || scene === 'paused';
  return (
    <div className={'hud' + (active && !entering ? ' visible' : '')}>
      <div className="crosshair">
        <span />
        <span />
      </div>
      <div className="hud-top-left">
        <TimeIndicator />
      </div>
      <DebugPanel />
      <Toast />
      {tips && !isTouch && scene === 'playing' && !entering && (
        <div className="tips glass-chip">WASD 移动 · 空格跳跃 · 左键破坏 · 右键放置 · F 飞行 · T 快进时间 · Esc 暂停</div>
      )}
      <Hotbar />
    </div>
  );
}
