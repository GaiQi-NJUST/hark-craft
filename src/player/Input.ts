/**
 * 输入系统：键盘、鼠标（指针锁定；不可用时回退为拖拽视角）、滚轮、触屏虚拟摇杆。
 * 引擎每帧读取并清空增量。
 */
export class Input {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  lookDX = 0;
  lookDY = 0;
  wheel = 0;
  breakHeld = false;
  placePressed = false;
  locked = false;
  /** 指针锁定失败 → 拖拽视角模式 */
  dragMode = false;
  enabled = false;

  // 触屏
  touchMove = { x: 0, y: 0 };
  touchJump = false;
  touchBreak = false;
  touchPlace = false;
  touchSprint = false;
  touchDown = false;

  onKey: ((code: string, e: KeyboardEvent) => void) | null = null;
  onUnlock: (() => void) | null = null;
  onLockError: (() => void) | null = null;

  private canvas: HTMLElement | null = null;
  private dragStart: { x: number; y: number; moved: boolean; button: number } | null = null;
  private lastLockExit = 0;

  attach(el: HTMLElement) {
    this.canvas = el;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    el.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    el.addEventListener('wheel', this.handleWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.handleLockChange);
    document.addEventListener('pointerlockerror', this.handleLockError);
  }

  requestLock() {
    const el = this.canvas;
    if (!el || this.dragMode) return;
    if (!('requestPointerLock' in el)) {
      this.dragMode = true;
      return;
    }
    // Chrome 退出锁定后约 1 秒内不能再次请求
    const wait = Math.max(0, 1100 - (performance.now() - this.lastLockExit));
    const go = () => {
      try {
        const r = (el as HTMLElement & { requestPointerLock: () => Promise<void> | void }).requestPointerLock();
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch(() => this.handleLockError());
        }
      } catch {
        this.handleLockError();
      }
    };
    if (wait > 0) setTimeout(go, wait);
    else go();
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** 边沿触发：本帧是否刚按下 */
  consumePress(code: string): boolean {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  endFrame() {
    this.lookDX = 0;
    this.lookDY = 0;
    this.wheel = 0;
    this.placePressed = false;
    this.touchPlace = false;
    this.pressed.clear();
  }

  isDown(code: string) {
    return this.keys.has(code);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (['Space', 'F3', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    if (!e.repeat) this.pressed.add(e.code);
    this.keys.add(e.code);
    this.onKey?.(e.code, e);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private handleBlur = () => {
    this.keys.clear();
    this.breakHeld = false;
  };

  private handleMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (this.locked) {
      if (e.button === 0) this.breakHeld = true;
      if (e.button === 2) this.placePressed = true;
      return;
    }
    if (!this.dragMode) {
      // 尚未锁定：点击即请求锁定
      this.requestLock();
    }
    this.dragStart = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
    if (e.button === 2) this.placePressed = true;
    if (e.button === 0) this.breakHeld = true;
  };

  private handleMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.breakHeld = false;
    this.dragStart = null;
  };

  private handleMouseMove = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (this.locked) {
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
      return;
    }
    if (this.dragStart) {
      const dx = e.clientX - this.dragStart.x, dy = e.clientY - this.dragStart.y;
      if (!this.dragStart.moved && dx * dx + dy * dy > 25) {
        this.dragStart.moved = true;
        this.breakHeld = false; // 拖拽视角时取消破坏
      }
      if (this.dragStart.moved) {
        this.lookDX += e.movementX * 1.4;
        this.lookDY += e.movementY * 1.4;
      }
    }
  };

  private handleWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.wheel += Math.sign(e.deltaY);
  };

  private handleLockChange = () => {
    const was = this.locked;
    this.locked = document.pointerLockElement === this.canvas;
    if (was && !this.locked) {
      this.lastLockExit = performance.now();
      this.breakHeld = false;
      this.onUnlock?.();
    }
  };

  private handleLockError = () => {
    this.dragMode = true;
    this.onLockError?.();
  };
}

export const input = new Input();
