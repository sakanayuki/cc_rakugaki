/**
 * セッション中のゲーム状態。
 * 絵（doc）だけが localStorage に保存され、連勝数と成長率はメニューに戻るとリセットされる。
 */

import type { PaintEngine } from '../paint/PaintEngine';
import type { CharacterDoc } from '../paint/types';
import type { CharacterAnalysis } from '../rig/partAnalyzer';
import type { Stats } from '../game/stats';
import { applyMultiplier } from '../game/stats';

/** 何連勝で優勝か */
export const WIN_TARGET = 5;
/** 3回以内の攻撃でKOしたときの上乗せ（初期ステータスに対する割合） */
export const GROWTH_KO = 0.2;
/** 必殺技で勝ったときの上乗せ */
export const GROWTH_SPECIAL = 0.1;
/** 敵が1戦ごとに強くなる倍率 */
export const ENEMY_SCALE_STEP = 1.1;

/** 勝ち方。成長量が変わる */
export type WinKind = 'ko' | 'special';

class GameStateStore {
  doc: CharacterDoc | null = null;
  /** 絵を保持している描画エンジン（プレビューと戦闘で使い回す） */
  engine: PaintEngine | null = null;
  /** 解析結果。リグ生成に使う */
  analysis: CharacterAnalysis | null = null;
  /** 絵から算出した素のステータス（不変） */
  baseStats: Stats | null = null;
  /** 成長率。初期値1.0で、勝つたびに加算されていく */
  growthRate = 1;
  winStreak = 0;
  enemyId: string | null = null;
  /** 直前の勝ち方。リザルト画面の表示に使う */
  lastWinKind: WinKind | null = null;

  /** 連勝チャレンジを初期状態に戻す（絵のセーブは消さない） */
  resetRun(): void {
    this.growthRate = 1;
    this.winStreak = 0;
    this.enemyId = null;
    this.lastWinKind = null;
  }

  /** 絵に関する状態をすべて捨てる */
  clearCharacter(): void {
    this.doc = null;
    this.engine = null;
    this.analysis = null;
    this.baseStats = null;
    this.resetRun();
  }

  /** 成長率を反映した実効ステータス */
  effectiveStats(): Stats {
    if (!this.baseStats) {
      throw new Error('ステータスがまだ算出されていません');
    }
    return applyMultiplier(this.baseStats, this.growthRate);
  }

  /** いま何戦目か（1オリジン） */
  get battleNumber(): number {
    return this.winStreak + 1;
  }

  /** この試合での敵のスケール。2戦目以降 1.1 のべき乗で強くなる */
  get enemyScale(): number {
    return ENEMY_SCALE_STEP ** (this.battleNumber - 1);
  }

  /** 最終戦（強敵のみのルーレットになる）か */
  get isFinalBattle(): boolean {
    return this.battleNumber === WIN_TARGET;
  }

  /** 勝利を記録して成長させる。勝ち方によって上乗せ量が変わる */
  registerWin(kind: WinKind): void {
    this.winStreak += 1;
    this.lastWinKind = kind;
    this.growthRate += kind === 'ko' ? GROWTH_KO : GROWTH_SPECIAL;
  }

  get isChampion(): boolean {
    return this.winStreak >= WIN_TARGET;
  }
}

export const gameState = new GameStateStore();
