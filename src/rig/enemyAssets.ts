/**
 * 敵の描画データを展開して、リグ用の解析結果とサムネイル画像を作る。
 * 何度も使うのでキャッシュしておく。
 */

import { enemyById } from '../game/enemies';
import { createCanvas, PaintEngine } from '../paint/PaintEngine';
import { COMPOSITE_ORDER } from '../paint/types';
import type { CharacterAnalysis } from './partAnalyzer';
import { analyzeCharacter } from './partAnalyzer';

export interface EnemyAssets {
  engine: PaintEngine;
  analysis: CharacterAnalysis;
  thumbnail: HTMLCanvasElement;
}

const cache = new Map<string, EnemyAssets>();

/** キャラクター全体を切り抜いて正方形のサムネイルにする */
function makeThumbnail(engine: PaintEngine, analysis: CharacterAnalysis, size = 192): HTMLCanvasElement {
  const canvas = createCanvas(size);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const part of Object.values(analysis.parts)) {
    minX = Math.min(minX, part.bbox.minX);
    minY = Math.min(minY, part.bbox.minY);
    maxX = Math.max(maxX, part.bbox.maxX);
    maxY = Math.max(maxY, part.bbox.maxY);
  }
  if (!Number.isFinite(minX)) return canvas;

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const scale = (size * 0.94) / Math.max(width, height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  const offsetX = (size - drawWidth) / 2;
  const offsetY = (size - drawHeight) / 2;

  for (const part of COMPOSITE_ORDER) {
    ctx.drawImage(
      engine.layerOf(part),
      minX,
      minY,
      width,
      height,
      offsetX,
      offsetY,
      drawWidth,
      drawHeight,
    );
  }
  return canvas;
}

export function getEnemyAssets(id: string): EnemyAssets {
  const cached = cache.get(id);
  if (cached) return cached;

  const enemy = enemyById(id);
  const engine = PaintEngine.fromDoc(structuredClone(enemy.doc));
  const analysis = analyzeCharacter(engine);
  const assets: EnemyAssets = { engine, analysis, thumbnail: makeThumbnail(engine, analysis) };
  cache.set(id, assets);
  return assets;
}
