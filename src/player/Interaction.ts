import * as THREE from 'three';
import { BLOCKS, B, IS_SOLID } from '../world/Blocks';
import type { World } from '../world/World';
import { TextureAtlas } from '../world/TextureAtlas';
import { raycastVoxel, type RayHit } from './Raycast';
import type { Input } from './Input';
import type { PlayerController } from './PlayerController';

/**
 * 方块交互：DDA 选中 + 发光描边、按住破坏（裂纹阶段）、右键放置。
 */
export class Interaction {
  readonly group = new THREE.Group();
  target: RayHit | null = null;
  private outline: THREE.LineSegments;
  private glow: THREE.Mesh;
  private crack: THREE.Mesh;
  private crackTex: THREE.CanvasTexture[];
  private crackMat: THREE.MeshBasicMaterial;
  private progress = 0;
  private progressKey = '';
  private cooldown = 0;
  private time = 0;
  private tmpO = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  reach = 6;

  constructor(scene: THREE.Scene) {
    const box = new THREE.BoxGeometry(1.004, 1.004, 1.004);
    const edges = new THREE.EdgesGeometry(box);
    this.outline = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: new THREE.Color(2.2, 2.0, 1.4), transparent: true, opacity: 0.95, depthTest: true }),
    );
    this.glow = new THREE.Mesh(
      new THREE.BoxGeometry(1.01, 1.01, 1.01),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.0, 0.9, 0.6),
        transparent: true,
        opacity: 0.07,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    this.crackTex = TextureAtlas.crackTextures(8);
    this.crackMat = new THREE.MeshBasicMaterial({
      map: this.crackTex[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), this.crackMat);
    this.crack.visible = false;
    this.group.add(this.outline, this.glow, this.crack);
    this.group.visible = false;
    scene.add(this.group);
  }

  update(
    dt: number,
    camera: THREE.Camera,
    world: World,
    input: Input,
    player: PlayerController,
    selected: number,
    active: boolean,
    cb: { onBreak: (id: number, x: number, y: number, z: number) => void; onPlace: (id: number, x: number, y: number, z: number) => void },
  ) {
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!active) {
      this.group.visible = false;
      this.target = null;
      this.progress = 0;
      return;
    }
    camera.getWorldPosition(this.tmpO);
    camera.getWorldDirection(this.tmpD);
    const hit = raycastVoxel((x, y, z) => world.getBlock(x, y, z), this.tmpO, this.tmpD, this.reach);
    this.target = hit;
    if (!hit) {
      this.group.visible = false;
      this.progress = 0;
      return;
    }
    this.group.visible = true;
    const isCross = BLOCKS[hit.id].render === 'cross';
    this.group.position.set(hit.x + 0.5, hit.y + (isCross ? 0.45 : 0.5), hit.z + 0.5);
    this.group.scale.set(isCross ? 0.72 : 1, isCross ? 0.9 : 1, isCross ? 0.72 : 1);
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 5);
    (this.outline.material as THREE.LineBasicMaterial).color.setRGB(2.3 * pulse, 2.05 * pulse, 1.4 * pulse);
    (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.04 * pulse;

    // 破坏
    const key = `${hit.x},${hit.y},${hit.z}`;
    const holding = input.breakHeld || input.touchBreak;
    if (holding && this.cooldown <= 0) {
      if (key !== this.progressKey) {
        this.progressKey = key;
        this.progress = 0;
      }
      const hard = BLOCKS[hit.id].hardness;
      if (Number.isFinite(hard)) this.progress += dt / Math.max(0.05, hard);
      if (this.progress >= 1) {
        const id = hit.id;
        if (world.setBlock(hit.x, hit.y, hit.z, B.AIR)) {
          // 失去支撑的植物一并移除
          const above = world.getBlock(hit.x, hit.y + 1, hit.z);
          if (BLOCKS[above].render === 'cross') world.setBlock(hit.x, hit.y + 1, hit.z, B.AIR);
          cb.onBreak(id, hit.x, hit.y, hit.z);
        }
        this.progress = 0;
        this.progressKey = '';
        this.cooldown = 0.12;
      }
    } else if (!holding) {
      this.progress = Math.max(0, this.progress - dt * 3);
    }
    if (this.progress > 0.02) {
      this.crack.visible = true;
      const stage = Math.min(7, Math.floor(this.progress * 8));
      if (this.crackMat.map !== this.crackTex[stage]) {
        this.crackMat.map = this.crackTex[stage];
        this.crackMat.needsUpdate = true;
      }
    } else this.crack.visible = false;

    // 放置
    if ((input.placePressed || input.touchPlace) && this.cooldown <= 0) {
      const replaceTarget = BLOCKS[hit.id].replaceable;
      const px = replaceTarget ? hit.x : hit.x + hit.nx;
      const py = replaceTarget ? hit.y : hit.y + hit.ny;
      const pz = replaceTarget ? hit.z : hit.z + hit.nz;
      const cur = world.getBlock(px, py, pz);
      if (BLOCKS[cur].replaceable && !(IS_SOLID[selected] && player.intersectsBlock(px, py, pz))) {
        if (world.setBlock(px, py, pz, selected)) {
          cb.onPlace(selected, px, py, pz);
          this.cooldown = 0.08;
        }
      }
    }
  }
}
