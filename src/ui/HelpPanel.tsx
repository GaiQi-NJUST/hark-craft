import { useGame } from '../store';

const DESKTOP: [string, string][] = [
  ['W A S D', '移动'],
  ['空格', '跳跃 / 飞行时上升'],
  ['Shift', '疾跑 / 飞行时下降'],
  ['F', '切换飞行模式'],
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
  ['左下摇杆', '移动'],
  ['右侧滑动', '转动视角'],
  ['「破坏」按住', '破坏方块'],
  ['「放置」点击', '放置方块'],
  ['「跳跃」', '跳跃 / 飞行时上升'],
  ['「飞行」', '切换飞行'],
  ['物品栏', '点击切换方块'],
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
        <p className="help-note">提示：持续一天约 6 分钟，从日出开始。夜晚会出现萤火虫，荧石会发光。</p>
        <button className="block-btn" onClick={() => setShow(false)}>
          知道了
        </button>
      </div>
    </div>
  );
}
