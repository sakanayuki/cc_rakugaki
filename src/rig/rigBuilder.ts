/**
 * 解析結果から Three.js のキャラクター（ペーパークラフト風）を組み立てる。
 *
 * 各パーツを「テクスチャを貼った板ポリゴン」にして、
 * からだに近い側の端をピボット（回転軸）にした階層でぶら下げる。
 * これだけで、どんな絵でもそれらしく関節が曲がって見える。
 */

import * as THREE from 'three';
import { CANVAS_SIZE } from '../paint/types';
import type { ActionEventName, ActionName, ChannelName } from './animations';
import { ACTIONS, CHANNEL_DEFAULT, sampleTrack } from './animations';
import type { BoneName, CharacterAnalysis, PartAnalysis } from './partAnalyzer';

/** 論理キャンバス1024pxを3Dの何ユニットに対応させるか */
export const UNITS_PER_CANVAS = 3;
const SCALE = UNITS_PER_CANVAS / CANVAS_SIZE;

/**
 * 前後関係（大きいほど手前）。
 * 紙の切り抜き人形なので、両うでは からだ より手前に置く。
 * 片方を後ろにすると、ばんざいポーズで腕が からだ に隠れてしまう。
 * 踏み込む側（+X側）の armR をいちばん手前にして、攻撃を見やすくする。
 */
const RENDER_ORDER: Record<BoneName, number> = {
  legL: 0,
  legR: 0,
  body: 1,
  armL: 2,
  armR: 3,
  head: 4,
};

const Z_OFFSET: Record<BoneName, number> = {
  legL: -0.05,
  legR: -0.05,
  body: 0,
  armL: 0.03,
  armR: 0.05,
  head: 0.07,
};

export type RigEventHandler = (name: ActionEventName, rig: CharacterRig) => void;

interface Bone {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  texture: THREE.CanvasTexture;
  geometry: THREE.PlaneGeometry;
}

export class CharacterRig {
  /** ワールド配置と向きを持つ外側のグループ */
  readonly container = new THREE.Group();
  /** アニメーションで動かす内側のグループ（足元が原点） */
  readonly root = new THREE.Group();

  readonly analysis: CharacterAnalysis;
  /** 足元から頭のてっぺんまでの高さ（3Dユニット） */
  readonly height: number;
  /** 中心軸から左右いずれかに張り出している最大幅（3Dユニット） */
  readonly halfWidth: number;
  readonly headCanvas: HTMLCanvasElement | null;

  private readonly bones = new Map<BoneName, Bone>();
  private readonly bodyGroup = new THREE.Group();
  private readonly shadow: THREE.Mesh;
  private readonly shield: THREE.Mesh;

  private action: ActionName = 'idle';
  private time = 0;
  /** 再生し終わったあと、最後のポーズのまま止めるか（倒れたままにする等） */
  private hold = false;
  private completed = false;
  private firedEvents = new Set<number>();
  private eventHandler: RigEventHandler | null = null;
  private finishResolve: (() => void) | null = null;
  private flashTimer = 0;
  private shieldTimer = 0;

  constructor(analysis: CharacterAnalysis) {
    this.analysis = analysis;
    this.container.add(this.root);
    this.root.add(this.bodyGroup);

    const toLocal = (px: number, py: number): THREE.Vector2 =>
      new THREE.Vector2(
        (px - analysis.bodyCenterX) * SCALE,
        (analysis.groundY - py) * SCALE,
      );

    const body = analysis.parts.body;
    const bodyPivot = body ? toLocal(body.centroid.x, body.centroid.y) : new THREE.Vector2(0, 0);
    this.bodyGroup.position.set(bodyPivot.x, bodyPivot.y, 0);

    /** パーツを、指定したピボット点まわりに回転する骨として追加する */
    const addBone = (part: PartAnalysis, pivotPoint: THREE.Vector2): void => {
      const pivot = new THREE.Group();
      pivot.position.set(
        pivotPoint.x - bodyPivot.x,
        pivotPoint.y - bodyPivot.y,
        Z_OFFSET[part.bone],
      );

      const texture = new THREE.CanvasTexture(part.canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.04,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const geometry = new THREE.PlaneGeometry(
        part.bbox.width * SCALE,
        part.bbox.height * SCALE,
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = RENDER_ORDER[part.bone];

      const center = toLocal(
        (part.bbox.minX + part.bbox.maxX) / 2,
        (part.bbox.minY + part.bbox.maxY) / 2,
      );
      mesh.position.set(center.x - pivotPoint.x, center.y - pivotPoint.y, 0);

      pivot.add(mesh);
      this.bodyGroup.add(pivot);
      this.bones.set(part.bone, { pivot, mesh, material, texture, geometry });
    };

    // からだ: 重心を回転の中心にする
    if (body) addBone(body, bodyPivot);

    // あたま: bboxの下端中央＝首の位置
    const head = analysis.parts.head;
    if (head) {
      addBone(head, toLocal((head.bbox.minX + head.bbox.maxX) / 2, head.bbox.maxY));
    }

    // うで: からだ側の端＝肩の位置
    const armL = analysis.parts.armL;
    if (armL) addBone(armL, toLocal(armL.bbox.maxX, armL.bbox.minY));
    const armR = analysis.parts.armR;
    if (armR) addBone(armR, toLocal(armR.bbox.minX, armR.bbox.minY));

    // あし: bboxの上端中央＝股関節の位置
    for (const bone of ['legL', 'legR'] as const) {
      const leg = analysis.parts[bone];
      if (leg) addBone(leg, toLocal((leg.bbox.minX + leg.bbox.maxX) / 2, leg.bbox.minY));
    }

    // 影
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 24),
      new THREE.MeshBasicMaterial({
        map: makeShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.4,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.shadow.renderOrder = -1;
    this.container.add(this.shadow);

    // 防御時に一瞬だけ出るシールド
    this.shield = new THREE.Mesh(
      new THREE.CircleGeometry(1.05, 28),
      new THREE.MeshBasicMaterial({
        color: 0x7fd8ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.shield.position.set(0.5, 1.1, 0.4);
    this.shield.renderOrder = 6;
    this.root.add(this.shield);

    let topY = 0;
    let halfWidth = 0;
    for (const part of Object.values(analysis.parts)) {
      topY = Math.max(topY, (analysis.groundY - part.bbox.minY) * SCALE);
      halfWidth = Math.max(
        halfWidth,
        Math.abs(part.bbox.minX - analysis.bodyCenterX) * SCALE,
        Math.abs(part.bbox.maxX - analysis.bodyCenterX) * SCALE,
      );
    }
    this.height = topY || UNITS_PER_CANVAS;
    this.halfWidth = halfWidth || UNITS_PER_CANVAS / 2;
    this.headCanvas = head ? head.canvas : null;

    this.applyPose(0);
  }

  /** 向き。1 = 右向き（+X方向へ攻撃）、-1 = 左向き */
  setFacing(direction: 1 | -1): void {
    this.container.scale.x = direction;
  }

  onEvent(handler: RigEventHandler | null): void {
    this.eventHandler = handler;
  }

  get currentAction(): ActionName {
    return this.action;
  }

  /**
   * アクションを再生する。ループしないアクションは終了時に resolve する Promise を返す。
   * hold を true にすると、終わったあと待機に戻らず最後のポーズで止まる。
   */
  play(action: ActionName, hold = false): Promise<void> {
    this.action = action;
    this.time = 0;
    this.hold = hold;
    this.completed = false;
    this.firedEvents.clear();
    if (this.finishResolve) {
      const resolve = this.finishResolve;
      this.finishResolve = null;
      resolve();
    }
    if (ACTIONS[action].loop) {
      this.applyPose(0);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.finishResolve = resolve;
      this.applyPose(0);
    });
  }

  /** 毎フレーム呼ぶ */
  update(dt: number): void {
    const def = ACTIONS[this.action];
    this.time += dt;

    let progress = def.duration > 0 ? this.time / def.duration : 1;
    let finished = false;
    if (def.loop) {
      progress -= Math.floor(progress);
    } else if (progress >= 1) {
      progress = 1;
      finished = !this.completed;
    }

    this.fireEvents(progress);
    this.applyPose(progress);

    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      const amount = this.flashTimer / FLASH_DURATION;
      const green = 1 - 0.65 * amount;
      for (const bone of this.bones.values()) {
        bone.material.color.setRGB(1, green, green);
      }
    }

    if (this.shieldTimer > 0) {
      this.shieldTimer = Math.max(0, this.shieldTimer - dt);
      const material = this.shield.material as THREE.MeshBasicMaterial;
      material.opacity = 0.55 * (this.shieldTimer / SHIELD_DURATION);
      this.shield.scale.setScalar(1 + 0.3 * (1 - this.shieldTimer / SHIELD_DURATION));
    }

    // 影はジャンプに合わせて小さく薄くする
    this.shadow.position.x = this.root.position.x;
    const lift = Math.max(0, this.root.position.y);
    const shrink = 1 / (1 + lift * 0.55);
    this.shadow.scale.setScalar(shrink);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.4 * shrink;

    if (finished) {
      this.completed = true;
      const resolve = this.finishResolve;
      this.finishResolve = null;
      if (!this.hold) {
        // 単発アクションが終わったら待機に戻す
        this.action = 'idle';
        this.time = 0;
        this.firedEvents.clear();
      }
      resolve?.();
    }
  }

  /** 赤く点滅させる（被ダメージ演出） */
  flash(): void {
    this.flashTimer = FLASH_DURATION;
  }

  /** 弾の発射位置（ワールド座標） */
  muzzleWorld(): THREE.Vector3 {
    const bone = this.bones.get('head') ?? this.bones.get('body');
    const point = new THREE.Vector3(0, this.height * 0.55, 0);
    if (bone) bone.pivot.getWorldPosition(point);
    point.x += this.container.scale.x * 0.5;
    return point;
  }

  /** 見た目の中心（ダメージ数字を出す位置の基準） */
  centerWorld(): THREE.Vector3 {
    const point = new THREE.Vector3();
    this.bodyGroup.getWorldPosition(point);
    return point;
  }

  dispose(): void {
    for (const bone of this.bones.values()) {
      bone.geometry.dispose();
      bone.material.dispose();
      bone.texture.dispose();
    }
    this.bones.clear();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.shadow.material as THREE.MeshBasicMaterial).dispose();
    this.shield.geometry.dispose();
    (this.shield.material as THREE.MeshBasicMaterial).dispose();
    this.container.removeFromParent();
  }

  private fireEvents(progress: number): void {
    const events = ACTIONS[this.action].events;
    if (!events) return;
    for (let i = 0; i < events.length; i++) {
      if (this.firedEvents.has(i) || progress < events[i].t) continue;
      this.firedEvents.add(i);
      const name = events[i].name;
      if (name === 'flash') this.flash();
      if (name === 'shield') this.shieldTimer = SHIELD_DURATION;
      this.eventHandler?.(name, this);
    }
  }

  private channel(name: ChannelName, progress: number): number {
    const track = ACTIONS[this.action].tracks[name];
    return track ? sampleTrack(track, progress) : CHANNEL_DEFAULT[name];
  }

  private applyPose(progress: number): void {
    this.root.position.x = this.channel('root.x', progress);
    this.root.position.y = this.channel('root.y', progress);
    this.root.rotation.y = this.channel('root.rotY', progress);
    this.root.rotation.z = this.channel('root.rotZ', progress);

    this.bodyGroup.rotation.z = this.channel('body.rotZ', progress);
    this.bodyGroup.scale.y = this.channel('body.scaleY', progress);

    this.setBoneRotation('head', this.channel('head.rotZ', progress));
    this.setBoneRotation('armL', this.channel('armL.rotZ', progress));
    this.setBoneRotation('armR', this.channel('armR.rotZ', progress));
    this.setBoneRotation('legL', this.channel('legL.rotZ', progress));
    this.setBoneRotation('legR', this.channel('legR.rotZ', progress));
  }

  private setBoneRotation(name: BoneName, value: number): void {
    const bone = this.bones.get(name);
    if (bone) bone.pivot.rotation.z = value;
  }
}

const FLASH_DURATION = 0.35;
const SHIELD_DURATION = 0.45;

/** ふんわりした丸い影のテクスチャ */
function makeShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
    gradient.addColorStop(0.6, 'rgba(0,0,0,0.28)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 解析結果からリグを作る */
export function buildCharacter(analysis: CharacterAnalysis): CharacterRig {
  return new CharacterRig(analysis);
}
