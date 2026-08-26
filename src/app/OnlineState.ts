/**
 * オンライン対戦のあいだだけ持つ状態。
 *
 * 接続はシーンより長生きさせる必要がある（画面を切り替えるたびに
 * unmount されるため）ので、gameState と同じくモジュールレベルに置く。
 * メインメニューに戻ったときに close() で片づける。
 */

import type { PvpEvent, PvpSide } from '../game/pvpEngine';
import type { Stats } from '../game/stats';
import { computeStats } from '../game/stats';
import { PaintEngine } from '../paint/PaintEngine';
import { CANVAS_SIZE } from '../paint/types';
import type { CharacterDoc } from '../paint/types';
import type { Reveal } from '../net/fairness';
import type { PeerLink } from '../net/PeerLink';
import type { CharacterAnalysis } from '../rig/partAnalyzer';
import { analyzeCharacter } from '../rig/partAnalyzer';

export interface FighterAssets {
  doc: CharacterDoc;
  analysis: CharacterAnalysis;
  stats: Stats;
}

/**
 * 絵からリグ用の解析とステータスを作る。
 *
 * オンライン対戦では**相手のステータスを受け取らず、届いた絵から自分で計算する**。
 * こうしておけば、相手が数値をいじっても効かないし、両方の端末で必ず同じ値になる。
 */
export function fighterFromDoc(doc: CharacterDoc): FighterAssets {
  const engine = PaintEngine.fromDoc(structuredClone(doc));
  try {
    const analysis = analyzeCharacter(engine);
    const stats = computeStats({
      bodyArea: analysis.areas.body,
      armsArea: analysis.areas.arms,
      legsArea: analysis.areas.legs,
      canvasArea: CANVAS_SIZE * CANVAS_SIZE,
      colorCount: analysis.colorCount,
      headAspect: analysis.headAspect,
      headDensity: analysis.headDensity,
    });
    return { doc, analysis, stats };
  } finally {
    // 1024x1024 のレイヤー（約20メガ）は解析が済んだら手放す
    engine.release();
  }
}

class OnlineStateStore {
  link: PeerLink | null = null;

  /** 自分と相手。相手のものは受け取った絵から作る */
  me: FighterAssets | null = null;
  opponent: FighterAssets | null = null;

  /** 何試合目か。commit / reveal はこの番号で対応づける */
  round = 0;

  /** この試合のじぶんの手（salt と nonce つき） */
  myReveal: Reveal | null = null;
  opponentCommit: string | null = null;
  opponentReveal: Reveal | null = null;

  /** 直前の試合の結果。リザルト画面が読む */
  lastEvents: PvpEvent[] | null = null;

  get isHost(): boolean {
    return this.link?.isHost ?? false;
  }

  /** 計算上の自分の側。画面の左右ではなく、host/guest の並び順 */
  get mySide(): PvpSide {
    return this.isHost ? 'host' : 'guest';
  }

  get opponentSide(): PvpSide {
    return this.isHost ? 'guest' : 'host';
  }

  /** 次の試合へ。絵と接続はそのまま、手だけ捨てる */
  startNextRound(): void {
    this.round += 1;
    this.myReveal = null;
    this.opponentCommit = null;
    this.opponentReveal = null;
    this.lastEvents = null;
  }

  /** 接続ごと片づける。メインメニューに戻るときに必ず呼ぶ */
  close(): void {
    this.link?.close();
    this.link = null;
    this.me = null;
    this.opponent = null;
    this.round = 0;
    this.myReveal = null;
    this.opponentCommit = null;
    this.opponentReveal = null;
    this.lastEvents = null;
  }
}

export const onlineState = new OnlineStateStore();
