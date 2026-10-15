import * as THREE from 'three';
import { useGame, type QualityTier } from '../store';
import { getQuality, type QualitySettings } from './Quality';
import { PostFX } from './PostFX';
import { Lighting } from './Lighting';
import { SkySystem, DAY_LENGTH_SEC } from './SkySystem';
import { World } from '../world/World';
import { BLOCKS } from '../world/Blocks';
import { getBlockTextures, TEX_LABEL, type BlockTextures, type BlockTexSet } from '../world/BlockTextures';
import { blockUniforms } from '../world/BlockMaterial';
import { BIOME_ZH } from '../world/TerrainGen';
import { PlayerController } from '../player/PlayerController';
import { input } from '../player/Input';
import { Interaction } from '../player/Interaction';
import { BlockBurst, AmbientParticles } from '../fx/Particles';
import { sharedUniforms } from '../fx/Foliage';
import { SplashScene, SPLASH_DURATION } from '../fx/SplashScene';
import { synth } from '../audio/Synth';

/**
 * 引擎：渲染器 + 主循环 + 场景编排。
 * 内部阶段：intro（开场方块动画）→ push（推入日出世界）→ world（标题/游戏/暂停）。
 */

type Phase = 'intro' | 'push' | 'world';

const PUSH_DURATION = 1.7;
const ENTER_DURATION = 1.35;
const TITLE_TIME = 0.022; // 标题画面：黄金时刻

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly world: World;
  readonly sky: SkySystem;
  readonly lighting: Lighting;
  readonly player = new PlayerController();
  readonly interaction: Interaction;
  readonly burst: BlockBurst;
  readonly ambient: AmbientParticles;
  readonly post: PostFX;
  readonly splash: SplashScene;
  readonly textures: BlockTextures;
  /** 输入系统（暴露给调试/自动化测试） */
  readonly input = input;

  private container: HTMLElement;
  private quality: QualitySettings;
  private phase: Phase = 'intro';
  private phaseT = 0;
  private elapsed = 0;
  private last = performance.now();
  private raf = 0;
  private tod = TITLE_TIME;
  private spawn = new THREE.Vector3();
  private titleAngle = 0;
  private enterT = -1;
  private enterFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private uiTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector2();
  private disposed = false;
  private unsub: (() => void)[] = [];
  private fadeGold = new THREE.Color(1.0, 0.86, 0.62);
  private fadeBlack = new THREE.Color(0, 0, 0);
  private autoplay = false;
  private fixedStep = false;
  private pausedAt = 0;
  /** 重新生成世界后，等出生区块加载完再挪到安全落脚点 */
  private pendingSafeSpawn = false;
  /** ?budget=ms：覆盖每帧区块生成预算（无头测试用） */
  private budgetOverride = 0;
  /** 自适应分辨率 */
  private adaptive = true;
  private dynPR = 1;
  private perfT = 0;
  private perfFrames = 0;
  private perfCooldown = 0;
  private texUiTimer = 0;
  /** 打开物品栏时退出指针锁定，不触发暂停 */
  private suppressUnlockPause = false;
  private lastSpace = 0;
  /** ?instant：跳过进入游戏的镜头过渡（无头测试） */
  private instantEnter = false;

  constructor(container: HTMLElement) {
    this.container = container;
    const st = useGame.getState();
    this.quality = getQuality(st.quality);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.dynPR = this.quality.pixelRatio;
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.65;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(72, container.clientWidth / container.clientHeight, 0.08, 1600);
    this.scene.fog = new THREE.Fog(0xa9c6e6, 60, 120);

    // 材质包：64x 基础版同步生成，高清版分帧渐进生成
    this.textures = getBlockTextures();
    this.textures.setAnisotropy(Math.min(st.isTouch ? 4 : 8, this.renderer.capabilities.getMaxAnisotropy()));
    this.textures.onChange = (set) => this.applyTextures(set);
    this.textures.request(st.texRes <= 64 ? st.texRes : 64);
    if (st.texRes > 64) this.textures.request(st.texRes);
    this.world = new World(st.worldSeed);
    this.scene.add(this.world.group);
    this.sky = new SkySystem(this.scene, this.renderer);
    this.lighting = new Lighting(this.scene);
    this.interaction = new Interaction(this.scene);
    this.burst = new BlockBurst(this.scene);
    this.ambient = new AmbientParticles(this.scene, this.quality.particles);

    this.splash = new SplashScene(this.renderer);
    this.splash.setAspect(container.clientWidth / container.clientHeight);

    this.post = new PostFX(this.renderer, this.splash.scene, this.splash.camera, !st.isTouch);
    this.post.setSize(container.clientWidth, container.clientHeight);

    this.applyQuality(st.quality);
    this.spawn.copy(this.world.findSpawn());

    input.attach(this.renderer.domElement);
    input.onKey = this.handleKey;
    input.onUnlock = () => {
      if (this.suppressUnlockPause) {
        this.suppressUnlockPause = false;
        return;
      }
      const s = useGame.getState();
      if (s.scene === 'playing' && !s.inventoryOpen) this.pause();
    };
    input.onLockError = () => {
      useGame.getState().setPointerLockSupported(false);
      useGame.getState().showToast('已切换为拖拽视角模式（按住鼠标拖动转向）');
    };

    window.addEventListener('resize', this.handleResize);
    const gesture = () => synth.unlock();
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);
    this.unsub.push(() => {
      window.removeEventListener('pointerdown', gesture);
      window.removeEventListener('keydown', gesture);
    });

    this.unsub.push(
      useGame.subscribe((s, prev) => {
        if (s.quality !== prev.quality) this.applyQuality(s.quality);
        if (s.muted !== prev.muted) synth.setMuted(s.muted);
        if (s.texRes !== prev.texRes) {
          this.textures.request(s.texRes);
          s.showToast(this.textures.pendingRes ? `材质包：${TEX_LABEL[s.texRes]} 生成中…` : `材质包：${TEX_LABEL[s.texRes]}`);
        }
        if (s.inventoryOpen !== prev.inventoryOpen) this.onInventory(s.inventoryOpen);
      }),
    );

    const params = new URLSearchParams(location.search);
    this.autoplay = params.has('autoplay');
    this.fixedStep = params.has('fixedStep');
    this.budgetOverride = Number(params.get('budget')) || 0;
    this.adaptive = !this.fixedStep && !params.has('noAdaptive');
    this.instantEnter = params.has('instant');
    if (params.has('texSync')) this.textures.finish();
    if (params.has('skipIntro') || this.autoplay) this.skipIntro();
    if (params.has('time')) this.tod = parseFloat(params.get('time')!) || TITLE_TIME;

    (window as unknown as { __hark: Engine; __harkStore: typeof useGame }).__hark = this;
    (window as unknown as { __harkStore: typeof useGame }).__harkStore = useGame;
    this.raf = requestAnimationFrame(this.loop);
  }

  // ───────────── 公共 API（供 UI 调用） ─────────────

  skipIntro() {
    if (this.phase !== 'intro') return;
    this.phase = 'push';
    this.phaseT = PUSH_DURATION * 0.55;
    this.toWorldView();
  }

  replayIntro() {
    input.exitLock();
    input.enabled = false;
    this.enterT = -1;
    useGame.getState().setEntering(false);
    this.splash.reset();
    this.phase = 'intro';
    this.phaseT = 0;
    this.post.setScene(this.splash.scene, this.splash.camera, false);
    useGame.getState().setScene('splash');
    synth.whoosh();
  }

  startGame() {
    const st = useGame.getState();
    if (st.scene !== 'title') return;
    synth.unlock();
    synth.pop('ui');
    // 确保出生点区块就绪
    this.player.spawn(this.world.findSafeSpot(this.spawn.x, this.spawn.z));
    // 朝向世界中心
    this.player.yaw = this.titleAngle;
    this.player.pitch = -0.12;
    this.enterFrom.pos.copy(this.camera.position);
    this.enterFrom.quat.copy(this.camera.quaternion);
    this.enterT = this.instantEnter ? ENTER_DURATION : 0;
    st.setEntering(true);
    st.setScene('playing');
    if (!st.isTouch) input.requestLock();
    if (this.tod < 0.02 || this.tod > 0.9) this.tod = 0.02;
  }

  resume() {
    const st = useGame.getState();
    if (st.scene !== 'paused') return;
    synth.pop('ui');
    st.setScene('playing');
    input.enabled = true;
    if (!st.isTouch) input.requestLock();
  }

  pause() {
    const st = useGame.getState();
    if (st.scene !== 'playing') return;
    input.enabled = false;
    input.breakHeld = false;
    this.pausedAt = performance.now();
    st.setScene('paused');
  }

  /** 切换飞行（F 键 / 双击跳跃） */
  toggleFly() {
    const st = useGame.getState();
    this.player.flying = !this.player.flying;
    this.player.velocity.y = 0;
    st.setFlying(this.player.flying);
    synth.pop('ui');
    st.showToast(this.player.flying ? (st.isTouch ? '飞行模式：开（▲ 上升 / ▼ 下降）' : '飞行模式：开（空格上升 / Shift 下降）') : '飞行模式：关');
  }

  openInventory(open: boolean) {
    const st = useGame.getState();
    if (open && st.scene !== 'playing') return;
    st.setInventoryOpen(open);
  }

  private onInventory(open: boolean) {
    const st = useGame.getState();
    synth.pop('ui');
    input.breakHeld = false;
    input.touchBreak = false;
    if (open) {
      input.enabled = false;
      if (input.locked) {
        this.suppressUnlockPause = true;
        input.exitLock();
      }
    } else if (st.scene === 'playing') {
      input.enabled = true;
      if (!st.isTouch) input.requestLock();
    }
  }

  private applyTextures(set: BlockTexSet) {
    blockUniforms.uAlb.value = set.albedo;
    blockUniforms.uNrm.value = set.normal;
    blockUniforms.uMer.value = set.mer;
    blockUniforms.uPBR.value = set.pbr ? 1 : 0;
    blockUniforms.uTexSize.value = set.res;
    useGame.getState().setTexProgress(1, this.textures.version);
  }

  regenerateWorld() {
    const st = useGame.getState();
    const seed = Math.floor(Math.random() * 1e9);
    st.setSeed(seed);
    this.world.reset(seed);
    this.spawn.copy(this.world.findSpawn());
    this.player.spawn(this.spawn);
    this.pendingSafeSpawn = true;
    this.tod = 0.02;
    st.showToast('新世界已生成 · 种子 ' + seed);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.handleResize);
    this.unsub.forEach((u) => u());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ───────────── 内部 ─────────────

  private applyQuality(tier: QualityTier) {
    const q = getQuality(tier);
    this.quality = q;
    this.dynPR = q.pixelRatio;
    this.renderer.setPixelRatio(q.pixelRatio);
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.lighting.configureShadow(q.shadowMapSize, q.shadowExtent);
    this.world.setPCSS(q.pcss);
    this.world.setShadowRadius(q.shadowExtent);
    this.sky.setQuality(q.cloudOctaves, q.envStep);
    this.world.setRenderDistance(q.renderDistance);
    const fog = this.scene.fog as THREE.Fog;
    fog.far = q.renderDistance * 16 - 4;
    fog.near = fog.far * 0.58;
    this.post.applyQuality(q, this.phase !== 'intro');
    this.post.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  private toWorldView() {
    this.post.setScene(this.scene, this.camera, true);
    this.post.applyQuality(this.quality, true);
  }

  private handleResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.splash.setAspect(w / h);
    this.post.setSize(w, h);
  };

  private handleKey = (code: string) => {
    const st = useGame.getState();
    if (st.scene === 'splash') {
      this.skipIntro();
      return;
    }
    if (code === 'KeyM') {
      st.setMuted(!st.muted);
      st.showToast(st.muted ? '声音：开' : '声音：关');
    }
    if (st.scene === 'playing') {
      if (code === 'Escape' && !input.locked) this.pause();
      if (code === 'F3') st.toggleDebug();
      if (code === 'KeyE') {
        this.openInventory(!st.inventoryOpen);
        return;
      }
      if (st.inventoryOpen) {
        if (code === 'Escape') this.openInventory(false);
        return;
      }
      if (code === 'KeyF') this.toggleFly();
      if (code === 'Space') {
        // 双击空格切换飞行（Java 版习惯）
        const now = performance.now();
        if (now - this.lastSpace < 300) {
          this.toggleFly();
          this.lastSpace = 0;
        } else this.lastSpace = now;
      }
      if (code.startsWith('Digit')) {
        const n = parseInt(code.slice(5), 10);
        if (n >= 1 && n <= 9) st.setSlot(n - 1);
      }
    } else if (st.scene === 'paused') {
      if (code === 'Escape' && !input.locked && !st.showHelp && performance.now() - this.pausedAt > 400) this.resume();
    }
  };

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    // ?fixedStep：固定步长（用于无头截图/录屏，保证时间轴一致）
    const realDt = Math.max(0.0001, (now - this.last) / 1000);
    const dt = this.fixedStep ? 1 / 60 : Math.min(0.05, realDt);
    this.last = now;
    this.elapsed += dt;
    sharedUniforms.uTime.value = this.elapsed;
    this.renderer.info.reset();

    // FPS
    this.fpsFrames++;
    this.fpsTime += realDt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    const st = useGame.getState();
    synth.update(dt);

    // 材质包渐进生成（开场动画期间预算更多）
    if (this.textures.pendingRes) {
      this.textures.step(this.phase === 'intro' ? 12 : 5);
      this.texUiTimer += realDt;
      if (this.texUiTimer > 0.3 && this.textures.pendingRes) {
        this.texUiTimer = 0;
        st.setTexProgress(this.textures.progress);
      }
    }

    if (this.phase === 'intro') {
      this.phaseT += dt;
      const r = this.splash.update(this.phaseT, dt);
      // 后台预生成标题画面的世界
      this.world.update(this.spawn, this.budgetOverride || 9);
      this.post.setScene(this.splash.scene, this.splash.camera, false);
      this.post.setBloom(0.75, 0.6, 0.85);
      this.splash.orbWorld && this.projectLight(this.splash.orbWorld, this.splash.camera, r.rays, this.fadeGold);
      this.post.setRayThreshold(0.85);
      this.renderer.toneMappingExposure = 0.9;
      this.post.setFade(r.fade, this.phaseT < 3 ? this.fadeBlack : this.fadeGold);
      this.post.render(dt, this.elapsed);
      if (this.phaseT >= SPLASH_DURATION) {
        this.phase = 'push';
        this.phaseT = 0;
        this.toWorldView();
      }
      return;
    }

    if (this.phase === 'push') {
      this.phaseT += dt;
      const k = ease(clamp01(this.phaseT / PUSH_DURATION));
      this.titleAngle = this.sunFacingAngle();
      const target = this.titlePose(this.tmpV);
      const lookAt = new THREE.Vector3(this.spawn.x, this.spawn.y + 2, this.spawn.z);
      const from = new THREE.Vector3(this.spawn.x + Math.sin(this.titleAngle) * 70, this.spawn.y + 70, this.spawn.z + Math.cos(this.titleAngle) * 70);
      this.camera.position.lerpVectors(from, target, k);
      this.camera.lookAt(lookAt.x, lookAt.y + (1 - k) * -8, lookAt.z);
      this.updateWorld(dt, this.spawn, false, 10);
      this.post.setFade(1 - clamp01(this.phaseT / (PUSH_DURATION * 0.6)), this.fadeGold);
      this.post.render(dt, this.elapsed);
      if (this.phaseT >= PUSH_DURATION) {
        this.phase = 'world';
        this.phaseT = 0;
        st.setScene('title');
      }
      return;
    }

    // ── world 阶段 ──
    this.post.setFade(0);
    if (st.scene === 'title') {
      this.titleAngle = this.sunFacingAngle();
      this.titlePose(this.camera.position);
      this.camera.lookAt(this.spawn.x, this.spawn.y + 2, this.spawn.z);
      this.tod += (TITLE_TIME - this.tod) * Math.min(1, dt * 2);
      this.updateWorld(dt, this.spawn, false, 8);
      if (this.autoplay && (this.world.isComplete() || (this.world.progress() > 0.45 && this.world.isMeshed(Math.floor(this.spawn.x), Math.floor(this.spawn.z))))) {
        this.autoplay = false;
        this.startGame();
      }
    } else if (st.scene === 'playing') {
      const fast = input.isDown('KeyT');
      this.tod = (this.tod + (dt / DAY_LENGTH_SEC) * (fast ? 40 : 1)) % 1;
      if (this.enterT >= 0) {
        // 从标题镜头平滑过渡到第一人称
        this.enterT += dt;
        const k = ease(clamp01(this.enterT / ENTER_DURATION));
        this.player.update(dt, input, this.world, this.camera, false);
        const toPos = this.camera.position.clone();
        const toQuat = this.camera.quaternion.clone();
        this.camera.position.lerpVectors(this.enterFrom.pos, toPos, k);
        this.camera.quaternion.slerpQuaternions(this.enterFrom.quat, toQuat, k);
        if (this.enterT >= ENTER_DURATION) {
          this.enterT = -1;
          input.enabled = true;
          st.setEntering(false);
        }
      } else {
        input.enabled = !st.inventoryOpen;
        if (input.wheel !== 0 && !st.inventoryOpen) st.setSlot(st.selectedSlot + input.wheel);
        this.player.update(dt, input, this.world, this.camera, !st.inventoryOpen);
        if (this.player.flying !== st.flying) st.setFlying(this.player.flying);
        if (this.player.sneaking !== st.sneaking) st.setSneaking(this.player.sneaking);
      }
      const gs = useGame.getState();
      const selected = gs.hotbar[gs.selectedSlot];
      const tapMode = gs.isTouch && gs.interactMode === 'tap';
      this.interaction.update(dt, this.camera, this.world, input, this.player, selected, this.enterT < 0 && !gs.inventoryOpen && (!tapMode || input.aim !== null), !tapMode || input.aimActive, {
        onBreak: (id, x, y, z) => {
          this.burst.emit(x, y, z, BLOCKS[id].particle, 26, BLOCKS[id].emissive > 1 ? 1.5 : 0);
          synth.pop('break', 0.8 + Math.random() * 0.4);
        },
        onPlace: () => synth.pop('place', 0.9 + Math.random() * 0.2),
      });
      if (!input.aimActive) input.aim = null;
      this.updateWorld(dt, this.player.position, true, this.quality.genBudgetMs);
      this.adaptResolution(realDt);
      if (this.pendingSafeSpawn && this.world.isMeshed(Math.floor(this.spawn.x), Math.floor(this.spawn.z))) {
        this.pendingSafeSpawn = false;
        this.player.spawn(this.world.findSafeSpot(this.spawn.x, this.spawn.z));
      }
    } else {
      // paused
      this.interaction.update(dt, this.camera, this.world, input, this.player, 0, false, false, { onBreak: () => {}, onPlace: () => {} });
      this.updateWorld(0, this.player.position, true, 3);
    }

    this.post.render(dt, this.elapsed);
    input.endFrame();

    // 低频 UI 同步
    this.uiTimer += dt;
    if (this.uiTimer > 0.25) {
      this.uiTimer = 0;
      st.setTime(this.tod);
      if (st.showDebug) {
        const p = this.player.position;
        const deg = ((((-this.player.yaw * 180) / Math.PI) % 360) + 360) % 360;
        const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
        const facing = dirs[Math.round(deg / 45) % 8];
        st.setDebug({
          fps: this.fps,
          x: p.x,
          y: p.y,
          z: p.z,
          chunks: this.world.chunkCount,
          drawCalls: this.renderer.info.render.calls,
          triangles: this.renderer.info.render.triangles,
          facing: `${facing} · ${BIOME_ZH[this.world.gen.biomeAt(p.x, p.z)]}`,
          flying: this.player.flying,
          pixelRatio: this.renderer.getPixelRatio(),
          tex: TEX_LABEL[this.textures.current?.res ?? 64] + (this.textures.pendingRes ? ` → ${this.textures.pendingRes}x ${Math.round(this.textures.progress * 100)}%` : ''),
        });
      }
    }
  };

  /** 自适应分辨率：持续掉帧时降低像素比，余量充足时回升 */
  private adaptResolution(realDt: number) {
    if (!this.adaptive) return;
    this.perfT += realDt;
    this.perfFrames++;
    this.perfCooldown = Math.max(0, this.perfCooldown - realDt);
    if (this.perfT < 2) return;
    const fps = this.perfFrames / this.perfT;
    this.perfT = 0;
    this.perfFrames = 0;
    if (this.perfCooldown > 0) return;
    const q = this.quality;
    let pr = this.dynPR;
    if (fps < 45 && pr > q.minPixelRatio + 0.01) pr = Math.max(q.minPixelRatio, pr - 0.15);
    else if (fps > 58 && pr < q.pixelRatio - 0.01) pr = Math.min(q.pixelRatio, pr + 0.1);
    if (pr !== this.dynPR) {
      this.dynPR = pr;
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
      this.post.setSize(this.container.clientWidth, this.container.clientHeight);
      this.perfCooldown = 4;
    }
  }

  /** 标题镜头朝向太阳（逆光 + 体积光），并缓慢左右摇摆 */
  private sunFacingAngle() {
    const d = this.sky.sunDirFromTime(TITLE_TIME, this.tmpV);
    return Math.atan2(-d.x, -d.z) + 0.42 * Math.sin(this.elapsed * 0.045);
  }

  private titlePose(out: THREE.Vector3) {
    const r = 30;
    return out.set(
      this.spawn.x + Math.sin(this.titleAngle) * r,
      this.spawn.y + 13 + Math.sin(this.titleAngle * 2.3) * 1.5,
      this.spawn.z + Math.cos(this.titleAngle) * r,
    );
  }

  private updateWorld(dt: number, focus: THREE.Vector3, gameplay: boolean, budget: number) {
    this.world.update(focus, this.budgetOverride || budget);
    this.sky.update(this.tod, this.elapsed, this.camera, this.lighting, this.scene, this.renderer, this.world.materials.water);
    this.lighting.follow(gameplay ? focus : this.tmpV.set(this.spawn.x, this.spawn.y, this.spawn.z));
    const s = this.sky.state;
    this.burst.update(dt, (x, y, z) => this.world.isSolid(x, y, z));
    this.ambient.update(dt, this.elapsed, gameplay ? focus : this.spawn, s.daylight, s.night, s.golden, this.renderer.getPixelRatio(), (x, z) =>
      this.world.surfaceHeight(x, z),
    );
    // 风力随时间缓慢变化
    sharedUniforms.uWind.value = 0.8 + 0.4 * Math.sin(this.elapsed * 0.11);

    // 体积光：朝向太阳
    const sunWorld = this.tmpV.copy(this.camera.position).addScaledVector(s.sunDir, 500);
    const rays = (0.55 + s.golden * 0.9) * clamp01((s.elevation + 0.05) / 0.12);
    this.projectLight(sunWorld, this.camera, rays, s.sunColor);
    this.post.setRayThreshold(0.75);
    this.post.setBloom(0.36 + s.night * 0.12, 0.5, 1.45 - s.night * 0.3);
  }

  private projectLight(world: THREE.Vector3, camera: THREE.PerspectiveCamera, intensity: number, color: THREE.Color) {
    camera.updateMatrixWorld();
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    const toLight = world.clone().sub(camera.position).normalize();
    const facing = camDir.dot(toLight);
    const p = world.clone().project(camera);
    const uv = this.tmpV2.set((p.x + 1) / 2, (p.y + 1) / 2);
    const off = Math.max(Math.abs(p.x), Math.abs(p.y));
    const vis = clamp01((facing - 0.1) / 0.4) * clamp01(1.6 - off * 0.6);
    this.post.setLight(uv, intensity * vis, color);
  }
}
