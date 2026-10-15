import { useEffect, useRef, useState } from 'react';
import { useGame } from '../store';
import { BLOCKS, CATEGORIES, blocksIn, type Category } from '../world/Blocks';
import { useIcon } from './Hotbar';
import { capture } from './TouchControls';

/**
 * 基岩版风格创造物品栏：分类标签（建筑 / 自然 / 装饰 / 光源）+ 可滚动方块网格 + 底部快捷栏。
 * - 点按方块 → 放入当前选中的快捷栏格
 * - 拖拽方块到快捷栏任意格 → 放入该格；拖拽快捷栏格到另一格 → 交换
 * - 点按快捷栏格 → 选中该格
 */

interface Drag {
  from: 'grid' | 'bar';
  id: number;
  slot: number;
  pid: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
  active: boolean;
}

export function Inventory() {
  const open = useGame((s) => s.inventoryOpen);
  const setOpen = useGame((s) => s.setInventoryOpen);
  const hotbar = useGame((s) => s.hotbar);
  const slot = useGame((s) => s.selectedSlot);
  const setSlot = useGame((s) => s.setSlot);
  const setHotbarSlot = useGame((s) => s.setHotbarSlot);
  const swapHotbar = useGame((s) => s.swapHotbar);
  const isTouch = useGame((s) => s.isTouch);
  const icon = useIcon();
  const [cat, setCat] = useState<Category>('build');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [flash, setFlash] = useState<{ slot: number; k: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  useEffect(() => {
    if (!open) setDrag(null);
  }, [open]);

  if (!open) return null;
  const list = blocksIn(cat);

  const put = (s: number, id: number) => {
    setHotbarSlot(s, id);
    setFlash({ slot: s, k: Date.now() });
  };

  const start = (e: React.PointerEvent, from: Drag['from'], id: number, s: number) => {
    e.preventDefault();
    e.stopPropagation();
    capture(e);
    setDrag({ from, id, slot: s, pid: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, active: false });
  };
  const move = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pid !== e.pointerId) return;
    const active = d.active || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 8;
    setDrag({ ...d, x: e.clientX, y: e.clientY, active });
    if (active) {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const t = el?.closest('[data-inv-slot]') as HTMLElement | null;
      setHover(t ? Number(t.dataset.invSlot) : null);
    }
  };
  const end = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pid !== e.pointerId) return;
    setDrag(null);
    setHover(null);
    if (!d.active) {
      // 点按
      if (d.from === 'grid') put(slot, d.id);
      else setSlot(d.slot);
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const t = el?.closest('[data-inv-slot]') as HTMLElement | null;
    if (!t) return;
    const to = Number(t.dataset.invSlot);
    if (d.from === 'grid') {
      put(to, d.id);
      setSlot(to);
    } else if (to !== d.slot) {
      swapHotbar(d.slot, to);
      if (slot === d.slot) setSlot(to);
      setFlash({ slot: to, k: Date.now() });
    }
  };
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: () => { setDrag(null); setHover(null); } };

  return (
    <div className="inv-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="inv-panel glass-panel" onContextMenu={(e) => e.preventDefault()}>
        <div className="inv-head">
          <h2 className="inv-title">创造物品栏</h2>
          <div className="inv-hint">{isTouch ? '点按放入选中格 · 拖到快捷栏任意格' : '点击放入选中格 · 拖拽到快捷栏 · E / Esc 关闭'}</div>
          <button className="inv-close" aria-label="关闭" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="inv-body">
          <div className="inv-tabs" role="tablist">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={cat === c.id}
                className={'inv-tab' + (cat === c.id ? ' on' : '')}
                onClick={() => setCat(c.id)}
              >
                <img src={icon(c.icon, 48)} alt="" draggable={false} />
                <span>{c.nameZh}</span>
              </button>
            ))}
          </div>
          <div className="inv-grid-wrap">
            <div className="inv-cat-name">{CATEGORIES.find((c) => c.id === cat)?.nameZh} · {list.length} 种</div>
            <div className="inv-grid">
              {list.map((b) => (
                <button
                  key={b.id}
                  className={'inv-item' + (hotbar[slot] === b.id ? ' in-slot' : '')}
                  data-block={b.key}
                  aria-label={b.nameZh}
                  onPointerDown={(e) => start(e, 'grid', b.id, -1)}
                  {...handlers}
                >
                  <img src={icon(b.id, 64)} alt="" draggable={false} />
                  <span className="inv-item-name">{b.nameZh}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="inv-bar">
          {hotbar.map((id, i) => (
            <button
              key={i + ':' + (flash?.slot === i ? flash.k : 0)}
              data-inv-slot={i}
              className={'inv-bar-slot' + (i === slot ? ' selected' : '') + (hover === i ? ' hover' : '') + (flash?.slot === i ? ' flash' : '')}
              aria-label={BLOCKS[id].nameZh}
              onPointerDown={(e) => start(e, 'bar', id, i)}
              {...handlers}
            >
              <img src={icon(id, 64)} alt="" draggable={false} />
            </button>
          ))}
        </div>
      </div>
      {drag?.active && (
        <img className="inv-ghost" src={icon(drag.id, 64)} alt="" style={{ transform: `translate(${drag.x - 28}px, ${drag.y - 28}px)` }} />
      )}
    </div>
  );
}
