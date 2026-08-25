/**
 * セーブデータ。localStorage に1スロットだけ、描画オペレーション列を保存する。
 * 連勝数・強化倍率は保存しない（セッション内のみ）。
 */

import type { CharacterDoc, DrawOp, PartId } from '../paint/types';
import { CANVAS_SIZE, STEP_ORDER } from '../paint/types';

const SAVE_KEY = 'rakugaki.save.v1';

function isPartId(value: unknown): value is PartId {
  return typeof value === 'string' && (STEP_ORDER as readonly string[]).includes(value);
}

function isValidOp(value: unknown): value is DrawOp {
  if (typeof value !== 'object' || value === null) return false;
  const op = value as Record<string, unknown>;
  if (typeof op.seq !== 'number' || !isPartId(op.part) || typeof op.color !== 'string') return false;
  if (op.type === 'stroke') {
    return (
      typeof op.width === 'number' &&
      Array.isArray(op.points) &&
      op.points.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 2 &&
          typeof point[0] === 'number' &&
          typeof point[1] === 'number',
      )
    );
  }
  if (op.type === 'fill') {
    return typeof op.x === 'number' && typeof op.y === 'number';
  }
  return false;
}

function isValidDoc(value: unknown): value is CharacterDoc {
  if (typeof value !== 'object' || value === null) return false;
  const doc = value as Record<string, unknown>;
  if (doc.version !== 1) return false;
  if (doc.canvasSize !== CANVAS_SIZE) return false;
  if (!Array.isArray(doc.ops) || !doc.ops.every(isValidOp)) return false;
  // name は第3版で足した任意フィールド。無くても弾かない
  if (doc.name !== undefined && typeof doc.name !== 'string') return false;
  return doc.currentStep === 'done' || isPartId(doc.currentStep);
}

/** 保存された絵を読む。壊れていたら捨てて null を返す（クラッシュさせない） */
export function loadDoc(): CharacterDoc | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidDoc(parsed)) {
      localStorage.removeItem(SAVE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveDoc(doc: CharacterDoc): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(doc));
  } catch {
    /* 容量オーバーやプライベートモードでは保存を諦める（ゲームは続行できる） */
  }
}

export function hasSave(): boolean {
  return loadDoc() !== null;
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* 何もしない */
  }
}
