/**
 * 敵の描画データを展開して、リグ用の解析結果とサムネイル画像を作る。
 * 何度も使うのでキャッシュしておく。
 */

import { enemyById } from '../game/enemies';
import { PaintEngine } from '../paint/PaintEngine';
import { thumbnailFromEngine } from '../paint/thumbnail';
import type { CharacterAnalysis } from './partAnalyzer';
import { analyzeCharacter } from './partAnalyzer';

export interface EnemyAssets {
  analysis: CharacterAnalysis;
  thumbnail: HTMLCanvasElement;
}

const cache = new Map<string, EnemyAssets>();

export function getEnemyAssets(id: string): EnemyAssets {
  const cached = cache.get(id);
  if (cached) return cached;

  const enemy = enemyById(id);
  const engine = PaintEngine.fromDoc(structuredClone(enemy.doc));
  const analysis = analyzeCharacter(engine);
  const assets: EnemyAssets = {
    analysis,
    thumbnail: thumbnailFromEngine(engine) ?? document.createElement('canvas'),
  };

  // 解析結果とサムネイルは切り抜き済みの小さなキャンバスなので、
  // ここで元の 1024x1024 レイヤー（約20MB）を手放す。
  // 6体ぶんを抱えたままだとモバイルでメモリを使い切ってしまう。
  engine.release();

  cache.set(id, assets);
  return assets;
}
