import * as THREE from 'three';
import { B } from '../world/Blocks';
import type { World } from '../world/World';
import type { Input } from './Input';

/**
 * 第一人称控制器：AABB 体素碰撞（分轴扫掠）、重力、跳跃、疾跑、飞行、游泳。
 */
const HALF_W = 0.3;
const HEIGHT = 1.8;
const EYE = 1.62;
const GRAVITY = 26;
const JUMP_V = 8.4;
const WALK = 4.6;
const SPRINT = 7.2;
const FLY = 11;
const FLY_FAST = 22;

export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  flying = false;
  onGround = false;
  inWater = false;
  sprinting = false;
  private bob = 0;
  private fovKick = 0;
  sensitivity = 0.0023;

  spawn(p: THREE.Vector3) {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.flying = false;
  }

  eye(out = new THREE.Vector3()) {
    return out.set(this.position.x, this.position.y + EYE, this.position.z);
  }

  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** 与 AABB 相交的方块是否有实体 */
  intersectsBlock(bx: number, by: number, bz: number) {
    const p = this.position;
    return (
      bx + 1 > p.x - HALF_W && bx < p.x + HALF_W &&
      by + 1 > p.y && by < p.y + HEIGHT &&
      bz + 1 > p.z - HALF_W && bz < p.z + HALF_W
    );
  }

  update(dt: number, input: Input, world: World, camera: THREE.PerspectiveCamera, active: boolean) {
    // 视角
    if (active) {
      const touchK = 2.2;
      this.yaw -= input.lookDX * this.sensitivity * (input.touchDown ? touchK : 1);
      this.pitch -= input.lookDY * this.sensitivity * (input.touchDown ? touchK : 1);
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    }

    const loaded = world.isMeshed(Math.floor(this.position.x), Math.floor(this.position.z));
    if (!loaded) {
      this.applyCamera(camera, dt, 0);
      return;
    }

    // 输入方向
    let fx = 0, fz = 0;
    if (active) {
      if (input.isDown('KeyW') || input.isDown('ArrowUp')) fz += 1;
      if (input.isDown('KeyS') || input.isDown('ArrowDown')) fz -= 1;
      if (input.isDown('KeyA') || input.isDown('ArrowLeft')) fx -= 1;
      if (input.isDown('KeyD') || input.isDown('ArrowRight')) fx += 1;
      fx += input.touchMove.x;
      fz += input.touchMove.y;
    }
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = fx * cos - fz * sin;
    const wishZ = -fx * sin - fz * cos;

    const jump = active && (input.isDown('Space') || input.touchJump);
    const shift = active && (input.isDown('ShiftLeft') || input.isDown('ShiftRight'));
    const ctrl = active && (input.isDown('ControlLeft') || input.isDown('KeyC'));
    this.sprinting = (shift && !this.flying) || (input.touchSprint && len > 0.5);
    if (len < 0.1) this.sprinting = false;

    const feet = world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + 0.2), Math.floor(this.position.z));
    const head = world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + 1.2), Math.floor(this.position.z));
    this.inWater = feet === B.WATER || head === B.WATER;

    if (this.flying) {
      const sp = ctrl || input.touchSprint ? FLY_FAST : FLY;
      const k = 1 - Math.exp(-8 * dt);
      this.velocity.x += (wishX * sp - this.velocity.x) * k;
      this.velocity.z += (wishZ * sp - this.velocity.z) * k;
      const vy = (jump ? 1 : 0) - (shift ? 1 : 0);
      this.velocity.y += (vy * sp * 0.8 - this.velocity.y) * k;
    } else {
      let sp = this.sprinting ? SPRINT : WALK;
      if (this.inWater) sp *= 0.55;
      const k = 1 - Math.exp(-(this.onGround ? 14 : this.inWater ? 6 : 3.2) * dt);
      this.velocity.x += (wishX * sp - this.velocity.x) * k;
      this.velocity.z += (wishZ * sp - this.velocity.z) * k;
      if (this.inWater) {
        this.velocity.y -= GRAVITY * 0.28 * dt;
        this.velocity.y = Math.max(this.velocity.y, -3.2);
        if (jump) this.velocity.y = Math.min(this.velocity.y + 22 * dt, 3.6);
      } else {
        this.velocity.y -= GRAVITY * dt;
        this.velocity.y = Math.max(this.velocity.y, -48);
        if (jump && this.onGround) {
          this.velocity.y = JUMP_V;
          this.onGround = false;
        }
      }
    }

    // 分轴移动 + 子步
    const steps = Math.ceil(Math.max(Math.abs(this.velocity.x), Math.abs(this.velocity.y), Math.abs(this.velocity.z)) * dt / 0.35) || 1;
    const sdt = dt / steps;
    this.onGround = false;
    for (let i = 0; i < steps; i++) {
      this.moveAxis(world, 1, this.velocity.y * sdt);
      this.moveAxis(world, 0, this.velocity.x * sdt);
      this.moveAxis(world, 2, this.velocity.z * sdt);
    }
    if (this.flying && this.onGround && !jump) this.flying = false; // 落地自动退出飞行

    // 防止掉出世界
    if (this.position.y < -10) {
      this.position.y = world.surfaceHeight(this.position.x, this.position.z) + 2;
      this.velocity.set(0, 0, 0);
    }

    const hspeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.applyCamera(camera, dt, this.onGround ? hspeed : 0);
  }

  private applyCamera(camera: THREE.PerspectiveCamera, dt: number, hspeed: number) {
    this.bob += hspeed * dt * 1.9;
    const bobAmp = Math.min(1, hspeed / WALK) * 0.045;
    camera.position.set(this.position.x, this.position.y + EYE + Math.abs(Math.sin(this.bob * Math.PI)) * bobAmp, this.position.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bob * Math.PI) * bobAmp * 0.08);
    const targetKick = this.sprinting ? 8 : this.flying && hspeed > 12 ? 10 : 0;
    this.fovKick += (targetKick - this.fovKick) * (1 - Math.exp(-6 * dt));
    const fov = 72 + this.fovKick;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  private moveAxis(world: World, axis: 0 | 1 | 2, d: number) {
    if (d === 0) return;
    const p = this.position;
    if (axis === 0) p.x += d;
    else if (axis === 1) p.y += d;
    else p.z += d;

    const minX = Math.floor(p.x - HALF_W), maxX = Math.floor(p.x + HALF_W - 1e-6);
    const minY = Math.floor(p.y), maxY = Math.floor(p.y + HEIGHT - 1e-6);
    const minZ = Math.floor(p.z - HALF_W), maxZ = Math.floor(p.z + HALF_W - 1e-6);
    const eps = 1e-4;
    for (let by = minY; by <= maxY; by++)
      for (let bz = minZ; bz <= maxZ; bz++)
        for (let bx = minX; bx <= maxX; bx++) {
          if (!world.isSolid(bx, by, bz)) continue;
          if (axis === 0) {
            p.x = d > 0 ? bx - HALF_W - eps : bx + 1 + HALF_W + eps;
            this.velocity.x = 0;
          } else if (axis === 1) {
            if (d > 0) p.y = by - HEIGHT - eps;
            else {
              p.y = by + 1 + eps;
              this.onGround = true;
            }
            this.velocity.y = 0;
          } else {
            p.z = d > 0 ? bz - HALF_W - eps : bz + 1 + HALF_W + eps;
            this.velocity.z = 0;
          }
          return;
        }
  }
}
