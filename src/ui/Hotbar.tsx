import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../store';
import { BLOCKS } from '../world/Blocks';
import { getBlockTextures } from '../world/BlockTextures';

/** 物品图标（随材质包刷新；像素 16x 时用像素图标） */
export function useIcon() {
  const ver = useGame((s) => s.texVersion);
  const pixel = useGame((s) => s.texRes === 16);
  return useMemo(() => {
    void ver;
    const tex = getBlockTextures();
    return (id: number, size = 64) => tex.icon(id, size, pixel);
  }, [ver, pixel]);
}

/**
 * 底部居中 9 格快捷栏 + 右端「…」物品栏按钮（基岩版布局）。
 * 位于 HUD 层（z-index 高于触屏视角层），点按即可切换方块。
 */
export function Hotbar() {
  const slot = useGame((s) => s.selectedSlot);
  const hotbar = useGame((s) => s.hotbar);
  const setSlot = useGame((s) => s.setSlot);
  const isTouch = useGame((s) => s.isTouch);
  const setInv = useGame((s) => s.setInventoryOpen);
  const icon = useIcon();
  const [nameKey, setNameKey] = useState(0);
  const selectedId = hotbar[slot];

  useEffect(() => setNameKey((k) => k + 1), [slot, selectedId]);

  return (
    <div className="hotbar-wrap">
      <div className="hotbar-name" key={nameKey}>
        {BLOCKS[selectedId]?.nameZh}
      </div>
      <div className="hotbar">
        {hotbar.map((id, i) => (
          <button
            key={i}
            data-slot={i}
            className={'hotbar-slot' + (i === slot ? ' selected' : '')}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSlot(i);
            }}
            aria-label={BLOCKS[id].nameZh}
          >
            <img src={icon(id)} alt="" draggable={false} />
            {!isTouch && <span className="slot-num">{i + 1}</span>}
          </button>
        ))}
        <button
          className="hotbar-slot hotbar-more"
          aria-label="物品栏"
          title="物品栏（E）"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setInv(true);
          }}
        >
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
        </button>
      </div>
    </div>
  );
}
