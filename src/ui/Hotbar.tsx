import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../store';
import { BLOCKS, HOTBAR } from '../world/Blocks';
import { getAtlas } from '../world/TextureAtlas';

/** 9 格物品栏：图标由图集实时生成（等距方块） */
export function Hotbar() {
  const slot = useGame((s) => s.selectedSlot);
  const setSlot = useGame((s) => s.setSlot);
  const icons = useMemo(() => HOTBAR.map((id) => getAtlas().icon(id, 64)), []);
  const [nameKey, setNameKey] = useState(0);

  useEffect(() => setNameKey((k) => k + 1), [slot]);

  return (
    <div className="hotbar-wrap">
      <div className="hotbar-name" key={nameKey}>
        {BLOCKS[HOTBAR[slot]].nameZh}
      </div>
      <div className="hotbar">
        {HOTBAR.map((id, i) => (
          <button
            key={id}
            className={'hotbar-slot' + (i === slot ? ' selected' : '')}
            onPointerDown={(e) => {
              e.stopPropagation();
              setSlot(i);
            }}
            aria-label={BLOCKS[id].nameZh}
          >
            <img src={icons[i]} alt="" draggable={false} />
            <span className="slot-num">{i + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
