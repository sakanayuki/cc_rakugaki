/**
 * 絵からステータスを算出する。
 * 原則は「おおきく ぬるほど つよい」。3歳児にも説明できるルールだけを使う。
 */

import type { Element } from './element';
import { judgeElement } from './element';

export interface Stats {
  /** 体力（からだパーツ由来） */
  maxHp: number;
  /** 攻撃力（うでパーツ由来） */
  atk: number;
  /** 素早さ（あしパーツ由来） */
  spd: number;
  /** 属性（あたまパーツ由来）。倍率強化の影響を受けない */
  element: Element;
}

/** 面積スコアの正規化に使う想定上限（キャンバス全体に対する比率） */
export const AREA_MAX = {
  body: 0.2,
  arms: 0.1,
  legs: 0.1,
} as const;

/** 各ステータスの素の値の範囲（星表示のスケールにも使う） */
export const STAT_RANGE = {
  maxHp: { min: 60, max: 150 },
  atk: { min: 10, max: 40 },
  spd: { min: 5, max: 25 },
} as const;

export interface StatsInput {
  /** からだパーツの不透明ピクセル数 */
  bodyArea: number;
  /** 両うで合計の不透明ピクセル数 */
  armsArea: number;
  /** 両あし合計の不透明ピクセル数 */
  legsArea: number;
  /** キャンバス全体のピクセル数 */
  canvasArea: number;
  /** 使ったパレット色の種類数 */
  colorCount: number;
  /** あたまbboxの 幅 / 高さ */
  headAspect: number;
  /** あたまの塗り密度（0..1） */
  headDensity: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** 面積比を 0..1 のスコアに正規化する */
export function areaScore(area: number, canvasArea: number, maxRatio: number): number {
  if (canvasArea <= 0) return 0;
  return clamp01(area / canvasArea / maxRatio);
}

/**
 * 色ボーナス。使った色の種類が多いほど全ステータスが少し上がる（最大+10%）。
 * 「いろを たくさん つかうと ちょっと つよくなる」と説明できる。
 */
export function colorBonus(colorCount: number): number {
  const extra = Math.max(0, Math.min(5, Math.floor(colorCount) - 1));
  return 1 + 0.02 * extra;
}

/** 絵の解析結果からステータスを算出する */
export function computeStats(input: StatsInput): Stats {
  const bonus = colorBonus(input.colorCount);
  const hpRaw = 60 + 90 * areaScore(input.bodyArea, input.canvasArea, AREA_MAX.body);
  const atkRaw = 10 + 30 * areaScore(input.armsArea, input.canvasArea, AREA_MAX.arms);
  const spdRaw = 5 + 20 * areaScore(input.legsArea, input.canvasArea, AREA_MAX.legs);

  return {
    maxHp: Math.round(hpRaw * bonus),
    atk: Math.round(atkRaw * bonus),
    spd: Math.round(spdRaw * bonus),
    element: judgeElement(input.headAspect, input.headDensity),
  };
}

/** 勝利ごとの強化（全ステータス1.5倍）。属性は変わらない */
export function applyMultiplier(base: Stats, multiplier: number): Stats {
  return {
    maxHp: Math.max(1, Math.round(base.maxHp * multiplier)),
    atk: Math.max(1, Math.round(base.atk * multiplier)),
    spd: Math.max(1, Math.round(base.spd * multiplier)),
    element: base.element,
  };
}

/** 値を1〜5個の星に変換する（プレビュー・リザルトの表示用） */
export function starsFor(value: number, key: keyof typeof STAT_RANGE): number {
  const { min, max } = STAT_RANGE[key];
  if (max <= min) return 1;
  const ratio = (value - min) / (max - min);
  return Math.max(1, Math.min(5, Math.ceil(ratio * 5)));
}
