/**
 * お絵かきエンジン。
 *
 * 絵は「オペレーション列（DrawOp[]）」として保持し、レイヤー画像はそこから再生される。
 * これにより undo・パーツやり直し・保存/復元がすべて同じ仕組みで成立する。
 *
 * 重要: 塗りつぶしの結果は実行時点の合成状態に依存するため、
 * 再生は必ず「全レイヤークリア → 全オペを seq 順に実行」で行う。
 */

import { computeFillMask, dilateFringe, isFillTooLarge, ALPHA_THRESHOLD } from './floodFill';
import type { CharacterDoc, DrawOp, PartId, StrokeOp } from './types';
import { CANVAS_SIZE, COMPOSITE_ORDER, STEP_ORDER, createEmptyDoc } from './types';

export type FillOutcome = 'ok' | 'too-large' | 'nothing';

/** 2D描画コンテキストつきのキャンバスを作る */
export function createCanvas(width: number, height = width): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement, readFrequently = false): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: readFrequently });
  if (!ctx) throw new Error('2Dコンテキストを取得できませんでした');
  return ctx;
}

/** 使ったパレット色の種類数（ステータスの色ボーナスに使う） */
export function usedColorCount(doc: CharacterDoc): number {
  const colors = new Set<string>();
  for (const op of doc.ops) colors.add(op.color.toLowerCase());
  return colors.size;
}

export class PaintEngine {
  readonly size = CANVAS_SIZE;

  private readonly layers = {} as Record<PartId, HTMLCanvasElement>;
  private readonly ctxs = {} as Record<PartId, CanvasRenderingContext2D>;
  private readonly composite: HTMLCanvasElement;
  private readonly compositeCtx: CanvasRenderingContext2D;
  private compositeDirty = true;
  private readonly counts = new Map<PartId, number>();

  private doc: CharacterDoc;
  private nextSeq = 0;
  private pending: { part: PartId; color: string; width: number; points: [number, number][] } | null =
    null;

  constructor(doc: CharacterDoc = createEmptyDoc()) {
    for (const part of STEP_ORDER) {
      const canvas = createCanvas(this.size);
      this.layers[part] = canvas;
      this.ctxs[part] = context2d(canvas, true);
    }
    this.composite = createCanvas(this.size);
    this.compositeCtx = context2d(this.composite, true);
    this.doc = doc;
    this.replay();
  }

  /** doc から描画エンジンを作る（敵キャラの描画データの展開にも使う） */
  static fromDoc(doc: CharacterDoc): PaintEngine {
    return new PaintEngine(doc);
  }

  getDoc(): CharacterDoc {
    return this.doc;
  }

  setDoc(doc: CharacterDoc): void {
    this.doc = doc;
    this.replay();
  }

  layerOf(part: PartId): HTMLCanvasElement {
    return this.layers[part];
  }

  opsOf(part: PartId): DrawOp[] {
    return this.doc.ops.filter((op) => op.part === part);
  }

  hasOps(part: PartId): boolean {
    return this.doc.ops.some((op) => op.part === part);
  }

  // ---------------------------------------------------------------- 再生

  /** 全レイヤーをクリアして、全オペを seq 順に描き直す */
  replay(): void {
    for (const part of STEP_ORDER) {
      this.ctxs[part].clearRect(0, 0, this.size, this.size);
    }
    this.counts.clear();
    this.compositeDirty = true;
    this.nextSeq = 0;

    const ops = [...this.doc.ops].sort((a, b) => a.seq - b.seq);
    for (const op of ops) {
      this.nextSeq = Math.max(this.nextSeq, op.seq + 1);
      if (op.type === 'stroke') {
        this.paintStroke(this.ctxs[op.part], op.color, op.width, op.points);
      } else {
        // 塗りつぶしは、その時点の合成画像を境界にして再計算する
        const data = this.compositeData();
        const result = computeFillMask(data.data, this.size, this.size, op.x, op.y);
        if (result) {
          if (!result.seedOpaque) dilateFringe(result.mask, data.data, this.size, this.size);
          this.paintMask(this.ctxs[op.part], result.mask, op.color);
        }
      }
      this.compositeDirty = true;
    }
  }

  // ---------------------------------------------------------------- 合成

  /** 全レイヤーを重ねた画像。塗りつぶしの境界判定と解析に使う */
  compositeCanvas(): HTMLCanvasElement {
    if (this.compositeDirty) {
      this.compositeCtx.clearRect(0, 0, this.size, this.size);
      for (const part of COMPOSITE_ORDER) {
        this.compositeCtx.drawImage(this.layers[part], 0, 0);
      }
      this.compositeDirty = false;
    }
    return this.composite;
  }

  compositeData(): ImageData {
    this.compositeCanvas();
    return this.compositeCtx.getImageData(0, 0, this.size, this.size);
  }

  /** 表示用。指定サイズに拡縮して描く */
  drawTo(ctx: CanvasRenderingContext2D, width: number, height = width): void {
    ctx.drawImage(this.compositeCanvas(), 0, 0, width, height);
  }

  // ---------------------------------------------------------------- 描画操作

  /** ストローク開始。以降 extendStroke で伸ばし、endStroke で確定する */
  beginStroke(part: PartId, color: string, width: number, x: number, y: number): void {
    this.pending = { part, color, width, points: [[x, y]] };
    const ctx = this.ctxs[part];
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.invalidate(part);
  }

  /** ストロークを伸ばす。近すぎる点は間引いてデータ量を抑える */
  extendStroke(x: number, y: number): void {
    const pending = this.pending;
    if (!pending) return;
    const last = pending.points[pending.points.length - 1];
    if (Math.hypot(x - last[0], y - last[1]) < 2) return;

    const ctx = this.ctxs[pending.part];
    ctx.save();
    ctx.strokeStyle = pending.color;
    ctx.lineWidth = pending.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last[0], last[1]);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();

    pending.points.push([x, y]);
    this.invalidate(pending.part);
  }

  /** ストローク確定。記録された DrawOp を返す */
  endStroke(): StrokeOp | null {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return null;
    const op: StrokeOp = {
      seq: this.nextSeq++,
      part: pending.part,
      type: 'stroke',
      color: pending.color,
      width: pending.width,
      points: pending.points,
    };
    this.doc.ops.push(op);
    this.touch();
    return op;
  }

  /**
   * 指定座標を塗りつぶす。
   * 囲われていない場所（キャンバスの大半が塗られてしまう場合）は拒否する。
   */
  fillAt(part: PartId, x: number, y: number, color: string): FillOutcome {
    const data = this.compositeData();
    const result = computeFillMask(data.data, this.size, this.size, x, y);
    if (!result) return 'nothing';
    if (isFillTooLarge(result.count, this.size, this.size)) return 'too-large';

    if (!result.seedOpaque) dilateFringe(result.mask, data.data, this.size, this.size);
    this.paintMask(this.ctxs[part], result.mask, color);
    this.doc.ops.push({
      seq: this.nextSeq++,
      part,
      type: 'fill',
      color,
      x: Math.round(x),
      y: Math.round(y),
    });
    this.invalidate(part);
    this.touch();
    return 'ok';
  }

  /** 現在パーツの最後の操作をひとつ取り消す */
  undo(part: PartId): boolean {
    for (let i = this.doc.ops.length - 1; i >= 0; i--) {
      if (this.doc.ops[i].part === part) {
        this.doc.ops.splice(i, 1);
        this.replay();
        this.touch();
        return true;
      }
    }
    return false;
  }

  /** 現在パーツをすべて消す */
  clearPart(part: PartId): void {
    const before = this.doc.ops.length;
    this.doc.ops = this.doc.ops.filter((op) => op.part !== part);
    if (this.doc.ops.length !== before) {
      this.replay();
      this.touch();
    }
  }

  // ---------------------------------------------------------------- 集計

  /** そのパーツの不透明ピクセル数 */
  partPixelCount(part: PartId): number {
    const cached = this.counts.get(part);
    if (cached !== undefined) return cached;

    const ctx = this.ctxs[part];
    const { data } = ctx.getImageData(0, 0, this.size, this.size);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] >= ALPHA_THRESHOLD) count++;
    }
    this.counts.set(part, count);
    return count;
  }

  /**
   * レイヤー画像のメモリを解放する。
   * 1インスタンスで 1024x1024 のキャンバスを5枚（約20MB）持つので、
   * 解析が済んで以降使わないもの（敵キャラなど）は明示的に捨てる。
   * 解放後は描画・解析に使えない。
   */
  release(): void {
    for (const part of STEP_ORDER) {
      this.layers[part].width = 0;
      this.layers[part].height = 0;
    }
    this.composite.width = 0;
    this.composite.height = 0;
    this.counts.clear();
  }

  // ---------------------------------------------------------------- 内部

  private invalidate(part: PartId): void {
    this.counts.delete(part);
    this.compositeDirty = true;
  }

  private touch(): void {
    this.doc.updatedAt = new Date().toISOString();
  }

  private paintStroke(
    ctx: CanvasRenderingContext2D,
    color: string,
    width: number,
    points: [number, number][],
  ): void {
    if (points.length === 0) return;
    ctx.save();
    if (points.length === 1) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(points[0][0], points[0][1], width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** マスクの形に色を塗る（既存の内容は消さず上に重ねる） */
  private paintMask(ctx: CanvasRenderingContext2D, mask: Uint8Array, color: string): void {
    const temp = createCanvas(this.size);
    const tempCtx = context2d(temp);
    const image = tempCtx.createImageData(this.size, this.size);
    const [r, g, b] = hexToRgb(color);
    for (let pixel = 0; pixel < mask.length; pixel++) {
      if (!mask[pixel]) continue;
      const i = pixel * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
    tempCtx.putImageData(image, 0, 0);
    ctx.drawImage(temp, 0, 0);
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return [0, 0, 0];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
