/**
 * Three.js のレンダラ・シーン・カメラをひとつだけ持ち、
 * プレビュー／戦闘／リザルトの各画面で使い回す。
 * 画面ごとにレンダラを作り直すとモバイルでコンテキストが枯渇するため。
 */

import * as THREE from 'three';
import type { CharacterRig } from '../rig/rigBuilder';

interface Tween {
  elapsed: number;
  duration: number;
  step: (progress: number) => void;
  done?: () => void;
}

/** カメラに収めたい範囲 */
export interface FrameRequest {
  /** 中心軸から左右に必要な幅 */
  halfWidth: number;
  /** 地面から必要な高さ */
  height: number;
  /** 余白（省略時は高さの25%） */
  margin?: number;
}

export class Stage3D {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly ground: THREE.Mesh;

  private container: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private framing: FrameRequest | null = null;
  private frameHandle = 0;
  private lastTime = 0;
  private readonly rigs = new Set<CharacterRig>();
  private readonly tweens: Tween[] = [];
  private readonly disposables: (() => void)[] = [];

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.position.set(0, 2.4, 9);
    this.camera.lookAt(0, 1.5, 0);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshBasicMaterial({ color: 0xc6e3a0 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = 0;
    this.ground.renderOrder = -2;
    this.scene.add(this.ground);
  }

  /** 指定要素にキャンバスを差し込んで描画を始める */
  mount(container: HTMLElement): void {
    this.unmount();
    this.container = container;
    container.append(this.renderer.domElement);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.lastTime = performance.now();
    const loop = (now: number) => {
      this.frameHandle = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.tick(dt);
      this.renderer.render(this.scene, this.camera);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  /** 描画を止めてキャンバスを取り外す。シーンの中身も片付ける */
  unmount(): void {
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
    this.observer?.disconnect();
    this.observer = null;
    this.renderer.domElement.remove();
    this.container = null;
    this.clear();
  }

  /** キャラクター・演出物をすべて片付ける */
  clear(): void {
    for (const rig of this.rigs) rig.dispose();
    this.rigs.clear();
    this.tweens.length = 0;
    this.framing = null;
    for (const dispose of this.disposables.splice(0)) dispose();
  }

  addRig(rig: CharacterRig): void {
    this.rigs.add(rig);
    this.scene.add(rig.container);
  }

  /**
   * 収めたい範囲を指定してカメラの距離を決める。
   * 画面の縦横比が変わっても収まり続けるよう、リサイズ時に計算し直す。
   */
  frame(request: FrameRequest): void {
    this.framing = request;
    this.applyFraming();
  }

  private applyFraming(): void {
    const framing = this.framing;
    if (!framing) return;

    const margin = framing.margin ?? framing.height * 0.25;
    const fovY = (this.camera.fov * Math.PI) / 180;
    const distanceForHeight = (framing.height / 2 + margin) / Math.tan(fovY / 2);
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * this.camera.aspect);
    const distanceForWidth = (framing.halfWidth + margin) / Math.tan(fovX / 2);
    const distance = Math.max(distanceForHeight, distanceForWidth);

    const centerY = framing.height / 2;
    // 少しだけ見下ろすと地面が見えて立体感が出る
    this.camera.position.set(0, centerY + framing.height * 0.14, distance);
    this.camera.lookAt(0, centerY, 0);
  }

  setGroundColor(color: number): void {
    (this.ground.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  /** 時間つきの補間処理を登録する */
  tween(duration: number, step: (progress: number) => void, done?: () => void): void {
    step(0);
    this.tweens.push({ elapsed: 0, duration, step, done });
  }

  /**
   * 飛び道具を飛ばす。パー属性の攻撃演出。
   * 描いた「あたま」の画像をそのまま弾にする。
   */
  launchProjectile(
    from: THREE.Vector3,
    to: THREE.Vector3,
    image: HTMLCanvasElement | null,
    onArrive?: () => void,
  ): void {
    const texture = image ? new THREE.CanvasTexture(image) : null;
    if (texture) texture.colorSpace = THREE.SRGBColorSpace;
    const geometry = new THREE.PlaneGeometry(0.7, 0.7);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: texture ? 0xffffff : 0xffd93d,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.04,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 8;
    mesh.position.copy(from);
    this.scene.add(mesh);

    const cleanup = () => {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      texture?.dispose();
    };
    this.disposables.push(cleanup);

    this.tween(
      0.42,
      (progress) => {
        mesh.position.lerpVectors(from, to, progress);
        // ふわっと山なりに飛ばす
        mesh.position.y += Math.sin(progress * Math.PI) * 0.55;
        mesh.rotation.z = progress * Math.PI * 3;
      },
      () => {
        cleanup();
        const index = this.disposables.indexOf(cleanup);
        if (index >= 0) this.disposables.splice(index, 1);
        onArrive?.();
      },
    );
  }

  private tick(dt: number): void {
    for (const rig of this.rigs) rig.update(dt);
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tween = this.tweens[i];
      tween.elapsed += dt;
      const progress = tween.duration > 0 ? Math.min(1, tween.elapsed / tween.duration) : 1;
      tween.step(progress);
      if (progress >= 1) {
        this.tweens.splice(i, 1);
        tween.done?.();
      }
    }
  }

  private resize(): void {
    const container = this.container;
    if (!container) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.applyFraming();
  }
}

let instance: Stage3D | null = null;

/** 使い回しの Stage3D を取得する */
export function getStage(): Stage3D {
  if (!instance) instance = new Stage3D();
  return instance;
}
