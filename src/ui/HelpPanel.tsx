import { useGame } from '../store';

const DESKTOP: [string, string][] = [
  ['W A S D', '移动'],
  ['空格', '跳跃 / 飞行时上升'],
  ['Shift', '疾跑 / 飞行时下降'],
  ['F / 双击空格', '切换飞行模式'],
  ['Ctrl', '潜行（不会从边缘掉落）'],
  ['E', '创造物品栏'],
  ['鼠标', '转动视角（点击画面锁定指针）'],
  ['左键（按住）', '破坏方块'],
  ['右键', '放置方块'],
  ['1–9 / 滚轮', '切换物品栏'],
  ['T（按住）', '时间快进'],
  ['F3', '调试信息（FPS / 坐标）'],
  ['M', '静音开关'],
  ['Esc', '暂停菜单'],
];

const TOUCH: [string, string][] = [
  ['左下摇杆', '移动（推到底疾跑）'],
  ['空白处拖动', '转动视角（可与摇杆同时）'],
  ['点按方块', '放置（点击交互模式）'],
  ['长按方块', '破坏（环形进度）'],
  ['「跳跃」双击', '切换飞行'],
  ['▲ / ▼', '飞行时上升 / 下降'],
  ['「潜行」', '潜行开关（不掉落）'],
  ['快捷栏 / 「…」', '切换方块 / 打开物品栏'],
  ['准星模式', '暂停菜单 → 交互方式'],
  ['≡ / F3', '暂停 / 调试信息'],
];

export function HelpPanel() {
  const show = useGame((s) => s.showHelp);
  const setShow = useGame((s) => s.setShowHelp);
  const isTouch = useGame((s) => s.isTouch);
  if (!show) return null;
  const rows = isTouch ? TOUCH : DESKTOP;
  return (
    <div className="modal-backdrop" onPointerDown={() => setShow(false)}>
      <div className="glass-panel help-panel" onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="panel-title">操作说明</h2>
        <div className="help-grid">
          {rows.map(([k, v]) => (
            <div className="help-row" key={k}>
              <kbd className="key">{k}</kbd>
              <span>{v}</span>
            </div>
          ))}
        </div>
        <p className="help-note">提示：一天约 6 分钟，从日出开始。夜晚荧石、灯笼、海晶灯会照亮周围；暂停菜单里可切换画质、材质包（像素 16x / 高清 256x）和按钮大小。</p>
        <button className="block-btn" onClick={() => setShow(false)}>
          知道了
        </button>
      </div>
    </div>
  );
}
