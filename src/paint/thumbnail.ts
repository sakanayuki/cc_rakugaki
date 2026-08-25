/**
 * 描いた絵を正方形のサムネイルに切り出す。
 * メニューのプレビューと、ルーレットの敵アイコンで共用する。
 */

import { ALPHA_THRESHOLD } from './floodFill';
import { createCanvas, PaintEngine } from './PaintEngine';
import type { CharacterDoc } from './types';

/** 描かれている部分の外接矩形。何も描かれていなければ null */
function contentBounds(
  data: Uint8ClampedArray,
  size: number,
): { x: number; y: number; width: number; height: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < size; y++) {
    const row = y * size;
    for (let x = 0; x < size; x++) {
      if (data[(row + x) * 4 + 3] < ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** 展開済みの描画エンジンから、キャラクター全体を収めた正方形サムネイルを作る */
export function thumbnailFromEngine(engine: PaintEngine, size = 192): HTMLCanvasElement | null {
  const bounds = contentBounds(engine.compositeData().data, engine.size);
  if (!bounds) return null;

  const canvas = createCanvas(size);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const scale = (size * 0.94) / Math.max(bounds.width, bounds.height);
  const drawWidth = bounds.width * scale;
  const drawHeight = bounds.height * scale;
  ctx.drawImage(
    engine.compositeCanvas(),
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    (size - drawWidth) / 2,
    (size - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  return canvas;
}

/**
 * 保存された絵からサムネイルを作る。
 * 1024x1024 のレイヤーを持つエンジンは約20MBあるので、描き終わったら必ず手放す。
 */
export function thumbnailFromDoc(doc: CharacterDoc, size = 192): HTMLCanvasElement | null {
  if (doc.ops.length === 0) return null;
  const engine = PaintEngine.fromDoc(structuredClone(doc));
  try {
    return thumbnailFromEngine(engine, size);
  } finally {
    engine.release();
  }
}
