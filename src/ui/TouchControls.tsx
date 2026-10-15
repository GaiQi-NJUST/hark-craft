import { useRef, useState } from 'react';
import { input } from '../player/Input';
import type { Engine } from '../engine/Engine';
import { useGame } from '../store';

/** 移动端：左下虚拟摇杆 + 右侧滑动转向 + 破坏/放置/跳跃/飞行按钮 */
export function TouchControls({ engine }: { engine: Engine | null }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const joyId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });
  const showToast = useGame((s) => s.showToast);

  const updateJoy = (cx: number, cy: number) => {
    const el = base.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const R = r.width / 2;
    let dx = cx - (r.left + R), dy = cy - (r.top + R);
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    setKnob({ x: dx, y: dy });
    input.touchMove.x = dx / R;
    input.touchMove.y = -dy / R;
    input.touchSprint = len > R * 0.95;
  };

  const btn = (label: string, cls: string, down: () => void, up?: () => void) => (
    <button
      className={'touch-btn ' + cls}
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); down(); }}
      onPointerUp={(e) => { e.preventDefault(); up?.(); }}
      onPointerCancel={() => up?.()}
    >
      {label}
    </button>
  );

  return (
    <div className="touch-layer">
      <div
        className="touch-look"
        onPointerDown={(e) => {
          if (lookId.current !== null) return;
          lookId.current = e.pointerId;
          lookLast.current = { x: e.clientX, y: e.clientY };
          input.touchDown = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.pointerId !== lookId.current) return;
          input.lookDX += e.clientX - lookLast.current.x;
          input.lookDY += e.clientY - lookLast.current.y;
          lookLast.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          if (e.pointerId === lookId.current) { lookId.current = null; input.touchDown = false; }
        }}
        onPointerCancel={() => { lookId.current = null; input.touchDown = false; }}
      />
      <div
        className="joystick"
        ref={base}
        onPointerDown={(e) => {
          joyId.current = e.pointerId;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          updateJoy(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => { if (e.pointerId === joyId.current) updateJoy(e.clientX, e.clientY); }}
        onPointerUp={() => {
          joyId.current = null;
          setKnob({ x: 0, y: 0 });
          input.touchMove.x = input.touchMove.y = 0;
          input.touchSprint = false;
        }}
        onPointerCancel={() => { joyId.current = null; setKnob({ x: 0, y: 0 }); input.touchMove.x = input.touchMove.y = 0; }}
      >
        <div className="joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <div className="touch-buttons">
        {btn('破坏', 'break', () => (input.touchBreak = true), () => (input.touchBreak = false))}
        {btn('放置', 'place', () => (input.touchPlace = true))}
        {btn('跳跃', 'jump', () => (input.touchJump = true), () => (input.touchJump = false))}
        {btn('飞行', 'fly', () => {
          if (!engine) return;
          engine.player.flying = !engine.player.flying;
          showToast(engine.player.flying ? '飞行模式：开' : '飞行模式：关');
        })}
      </div>
      <button className="touch-pause" onPointerDown={(e) => { e.stopPropagation(); engine?.pause(); }}>
        Ⅱ
      </button>
    </div>
  );
}
