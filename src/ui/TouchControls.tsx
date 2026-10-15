import { useEffect, useRef, useState } from 'react';
import { input } from '../player/Input';
import type { Engine } from '../engine/Engine';
import { useGame, BUTTON_SCALE } from '../store';

/**
 * 移动端触屏布局（参照 Minecraft 基岩版 / 携带版）：
 * - 左下：固定虚拟摇杆（50% 不透明），推到底 = 疾跑
 * - 右下：跳跃（双击切换飞行）+ 潜行；飞行时变为 ▲ 上升 / ▼ 下降
 * - 屏幕任意空白处拖动 = 转视角（多点触控：可同时移动 + 转向）
 * - 点击交互：点按 = 在触点放置，长按 = 在触点破坏（环形进度）；准星模式：准星 + 挖/放按钮
 * 物品栏、暂停、F3 等按钮位于 HUD 层（z-index 高于本层），不会被视角层吞掉触摸。
 */

/** ?slowInput：无头测试环境帧率极低时放宽长按 / 双击判定窗口 */
const SLOW = typeof location !== 'undefined' && new URLSearchParams(location.search).has('slowInput') ? 20 : 1;
const HOLD_MS = 260 * SLOW;
const DOUBLE_TAP_MS = 300 * SLOW;

/** 指针捕获：部分 WebView / 合成触摸会抛异常，失败时忽略（不影响按钮逻辑） */
export function capture(e: React.PointerEvent) {
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    /* 忽略 */
  }
}
const TAP_SLOP = 12;

export function TouchControls({ engine }: { engine: Engine | null }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0, sprint: false });
  const joyId = useRef<number | null>(null);
  const look = useRef<{
    id: number; x: number; y: number; sx: number; sy: number; t: number; moved: boolean; breaking: boolean; timer: number;
  } | null>(null);
  const ring = useRef<HTMLDivElement>(null);
  const ringArc = useRef<SVGCircleElement>(null);
  const lastJump = useRef(0);
  const mode = useGame((s) => s.interactMode);
  const size = useGame((s) => s.buttonSize);
  const flying = useGame((s) => s.flying);
  const sneaking = useGame((s) => s.sneaking);

  // 清理：卸载时松开所有按键
  useEffect(
    () => () => {
      input.touchMove.x = input.touchMove.y = 0;
      input.touchSprint = input.touchJump = input.touchBreak = false;
      input.touchFlyUp = input.touchFlyDown = false;
      input.aimActive = false;
      input.touchDown = false;
    },
    [],
  );

  // 环形进度：先显示长按蓄力，再显示破坏进度
  useEffect(() => {
    let raf = 0;
    const C = 2 * Math.PI * 26;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const l = look.current;
      const el = ring.current, arc = ringArc.current;
      if (!el || !arc) return;
      if (!l || mode !== 'tap' || l.moved) {
        el.style.opacity = '0';
        return;
      }
      const held = (performance.now() - l.t) / HOLD_MS;
      let p: number;
      if (!l.breaking) p = Math.min(1, held) * 0.25;
      else p = 0.25 + 0.75 * Math.min(1, engine?.interaction.progress ?? 0);
      el.style.opacity = held > 0.25 || l.breaking ? '1' : '0';
      el.style.transform = `translate(${l.x - 32}px, ${l.y - 32}px)`;
      arc.style.strokeDashoffset = String(C * (1 - p));
      el.classList.toggle('breaking', l.breaking);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, mode]);

  const ndc = (x: number, y: number) => ({ x: (x / window.innerWidth) * 2 - 1, y: -(y / window.innerHeight) * 2 + 1 });

  const updateJoy = (cx: number, cy: number) => {
    const el = base.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const R = r.width / 2;
    let dx = cx - (r.left + R), dy = cy - (r.top + R);
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    const sprint = len > R * 0.92;
    setKnob({ x: dx, y: dy, sprint });
    input.touchMove.x = dx / R;
    input.touchMove.y = -dy / R;
    input.touchSprint = sprint;
  };
  const releaseJoy = () => {
    joyId.current = null;
    setKnob({ x: 0, y: 0, sprint: false });
    input.touchMove.x = input.touchMove.y = 0;
    input.touchSprint = false;
  };

  const endLook = (e: React.PointerEvent, cancelled: boolean) => {
    const l = look.current;
    if (!l || e.pointerId !== l.id) return;
    clearTimeout(l.timer);
    if (mode === 'tap' && !cancelled && !l.moved && !l.breaking && e.timeStamp - l.t < HOLD_MS + 60) {
      // 点按 → 在触点放置
      input.aim = ndc(e.clientX, e.clientY);
      input.touchPlace = true;
    }
    input.touchBreak = false;
    input.aimActive = false;
    input.touchDown = false;
    look.current = null;
  };

  /** 按钮：按下/抬起回调，捕获指针以支持多点触控 */
  const hold = (down: (e?: React.PointerEvent) => void, up?: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      capture(e);
      (e.currentTarget as HTMLElement).classList.add('pressed');
      down(e);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).classList.remove('pressed');
      up?.();
    },
    onPointerCancel: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).classList.remove('pressed');
      up?.();
    },
  });

  const onJumpDown = (e?: React.PointerEvent) => {
    const now = e ? e.timeStamp : performance.now();
    if (now - lastJump.current < DOUBLE_TAP_MS) {
      lastJump.current = 0;
      input.touchJump = input.touchFlyUp = false;
      engine?.toggleFly();
      return;
    }
    lastJump.current = now;
    if (useGame.getState().flying) input.touchFlyUp = true;
    else input.touchJump = true;
  };
  const onJumpUp = () => {
    input.touchJump = false;
    input.touchFlyUp = false;
  };

  return (
    <div className={`touch-layer btn-${size} mode-${mode}`} style={{ ['--s' as string]: BUTTON_SCALE[size] }}>
      <div
        className="touch-look"
        onPointerDown={(e) => {
          if (look.current) return;
          capture(e);
          const l = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: e.timeStamp, moved: false, breaking: false, timer: 0 };
          look.current = l;
          if (mode === 'tap') {
            input.aim = ndc(e.clientX, e.clientY);
            input.aimActive = true;
            l.timer = window.setTimeout(() => {
              if (look.current === l && !l.moved) {
                l.breaking = true;
                input.touchBreak = true;
                navigator.vibrate?.(12);
              }
            }, HOLD_MS);
          }
        }}
        onPointerMove={(e) => {
          const l = look.current;
          if (!l || e.pointerId !== l.id) return;
          const dx = e.clientX - l.x, dy = e.clientY - l.y;
          l.x = e.clientX;
          l.y = e.clientY;
          const far = Math.hypot(e.clientX - l.sx, e.clientY - l.sy) > TAP_SLOP;
          // 用事件时间戳判断：主线程繁忙时长按计时器可能先于排队的移动事件触发
          if (!l.moved && far && (!l.breaking || e.timeStamp - l.t < HOLD_MS)) {
            l.moved = true;
            l.breaking = false;
            input.touchBreak = false;
            clearTimeout(l.timer);
            input.aimActive = false;
          }
          if (l.breaking) {
            // 长按破坏中：手指移动 = 移动目标点
            input.aim = ndc(e.clientX, e.clientY);
          } else if (l.moved || mode === 'crosshair') {
            input.touchDown = true;
            input.lookDX += dx;
            input.lookDY += dy;
          }
        }}
        onPointerUp={(e) => endLook(e, false)}
        onPointerCancel={(e) => endLook(e, true)}
      />

      <div className={'touch-ring'} ref={ring}>
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26" className="ring-bg" />
          <circle cx="32" cy="32" r="26" className="ring-fg" ref={ringArc} strokeDasharray={String(2 * Math.PI * 26)} />
        </svg>
      </div>

      <div
        className="joystick"
        ref={base}
        onPointerDown={(e) => {
          e.stopPropagation();
          joyId.current = e.pointerId;
          capture(e);
          updateJoy(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => { if (e.pointerId === joyId.current) updateJoy(e.clientX, e.clientY); }}
        onPointerUp={(e) => { if (e.pointerId === joyId.current) releaseJoy(); }}
        onPointerCancel={releaseJoy}
      >
        <div className="joystick-ring" />
        <div className={'joystick-knob' + (knob.sprint ? ' sprint' : '')} style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>

      <div className="touch-right">
        {mode === 'crosshair' && (
          <div className="action-row">
            <button className="touch-btn act break" aria-label="挖" {...hold(() => (input.touchBreak = true), () => (input.touchBreak = false))}>挖</button>
            <button className="touch-btn act place" aria-label="放" {...hold(() => (input.touchPlace = true))}>放</button>
          </div>
        )}
        <div className="move-row">
          {flying ? (
            <button className="touch-btn sneak fly-down" aria-label="下降" {...hold(() => (input.touchFlyDown = true), () => (input.touchFlyDown = false))}>
              <span className="arrow">▼</span>
            </button>
          ) : (
            <button
              className={'touch-btn sneak' + (sneaking ? ' on' : '')}
              aria-label="潜行"
              {...hold(() => {
                input.touchSneak = !input.touchSneak;
              })}
            >
              <span className="sneak-icon" />
              <span className="lbl">潜行</span>
            </button>
          )}
          <button className={'touch-btn jump' + (flying ? ' fly-up' : '')} aria-label={flying ? '上升' : '跳跃'} {...hold(onJumpDown, onJumpUp)}>
            <span className="arrow">▲</span>
            {!flying && <span className="lbl">跳跃</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
