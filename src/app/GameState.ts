/**
 * セッション中のゲーム状態。
 * 絵（doc）だけが localStorage に保存され、連勝数と強化倍率はメニューに戻るとリセットされる。
 */

import type { PaintEngine } from '../paint/PaintEngine';
import type { CharacterDoc } from '../paint/types';
import type { CharacterAnalysis } from '../rig/partAnalyzer';
import type { Stats } from '../game/stats';
import { applyMultiplier } from '../game/stats';

/** 何連勝で優勝か */
export const WIN_TARGET = 5;
/** 勝つたびの強化倍率 */
export const MULTIPLIER_STEP = 1.5;

class GameStateStore {
  doc: CharacterDoc | null = null;
  /** 絵を保持している描画エンジン（プレビューと戦闘で使い回す） */
  engine: PaintEngine | null = null;
  /** 解析結果。リグ生成に使う */
  analysis: CharacterAnalysis | null = null;
  /** 絵から算出した素のステータス */
  baseStats: Stats | null = null;
  /** 勝利ごとに ×1.5 されていく */
  multiplier = 1;
  winStreak = 0;
  enemyId: string | null = null;

  /** 連勝チャレンジを初期状態に戻す（絵のセーブは消さない） */
  resetRun(): void {
    this.multiplier = 1;
    this.winStreak = 0;
    this.enemyId = null;
  }

  /** 絵に関する状態をすべて捨てる */
  clearCharacter(): void {
    this.doc = null;
    this.engine = null;
    this.analysis = null;
    this.baseStats = null;
    this.resetRun();
  }

  /** 強化倍率を反映した実効ステータス */
  effectiveStats(): Stats {
    if (!this.baseStats) {
      throw new Error('ステータスがまだ算出されていません');
    }
    return applyMultiplier(this.baseStats, this.multiplier);
  }

  /** 勝利を記録して強化する */
  registerWin(): void {
    this.winStreak += 1;
    this.multiplier *= MULTIPLIER_STEP;
  }

  get isChampion(): boolean {
    return this.winStreak >= WIN_TARGET;
  }
}

export const gameState = new GameStateStore();
