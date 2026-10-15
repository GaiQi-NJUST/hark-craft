import * as THREE from 'three';

/**
 * 光照：唯一一盏投影平行光（白天=太阳，夜晚=月光）+ 半球光补光。
 * 阴影相机紧贴玩家并按阴影贴图纹素对齐，避免移动时阴影闪烁。
 */
export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  private extent = 48;
  private mapSize = 2048;
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3(0.3, 1, 0.2).normalize();

  constructor(scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.045;
    this.sun.shadow.radius = 2;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd7ff, 0x5a4a32, 0.8);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.04);
    scene.add(this.ambient);
    this.configureShadow(2048, 48);
  }

  configureShadow(mapSize: number, extent: number) {
    this.mapSize = mapSize;
    this.extent = extent;
    const s = this.sun.shadow;
    s.mapSize.set(mapSize, mapSize);
    const cam = s.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = 260;
    cam.updateProjectionMatrix();
    if (s.map) {
      s.map.dispose();
      (s as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
  }

  /** dir: 指向光源的单位向量 */
  setDirection(dir: THREE.Vector3) {
    this.dir.copy(dir).normalize();
  }

  /** 跟随焦点，阴影相机纹素对齐 */
  follow(focus: THREE.Vector3) {
    const texel = (this.extent * 2) / this.mapSize;
    // 在光源空间中对齐：先构建光源基
    const d = this.dir;
    const up = Math.abs(d.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, d).normalize();
    const up2 = new THREE.Vector3().crossVectors(d, right).normalize();
    const px = Math.round(focus.dot(right) / texel) * texel;
    const py = Math.round(focus.dot(up2) / texel) * texel;
    const pz = focus.dot(d);
    const snapped = this.tmp.set(0, 0, 0).addScaledVector(right, px).addScaledVector(up2, py).addScaledVector(d, pz);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(d, 120);
    this.sun.target.updateMatrixWorld();
  }
}
