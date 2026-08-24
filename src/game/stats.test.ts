import { describe, expect, it } from 'vitest';
import { AREA_MAX, applyMultiplier, areaScore, colorBonus, computeStats, starsFor } from './stats';

const CANVAS_AREA = 1024 * 1024;

/** 面積比を指定してステータス入力を作る */
function input(options: {
  bodyRatio?: number;
  armsRatio?: number;
  legsRatio?: number;
  colorCount?: number;
  headAspect?: number;
  headDensity?: number;
}) {
  return {
    bodyArea: CANVAS_AREA * (options.bodyRatio ?? 0),
    armsArea: CANVAS_AREA * (options.armsRatio ?? 0),
    legsArea: CANVAS_AREA * (options.legsRatio ?? 0),
    canvasArea: CANVAS_AREA,
    colorCount: options.colorCount ?? 1,
    headAspect: options.headAspect ?? 1,
    headDensity: options.headDensity ?? 0.6,
  };
}

describe('areaScore', () => {
  it('想定上限で 1 になる', () => {
    expect(areaScore(CANVAS_AREA * AREA_MAX.body, CANVAS_AREA, AREA_MAX.body)).toBe(1);
  });

  it('上限を超えても 1 で頭打ちになる', () => {
    expect(areaScore(CANVAS_AREA * 0.9, CANVAS_AREA, AREA_MAX.body)).toBe(1);
  });

  it('何も描いていなければ 0', () => {
    expect(areaScore(0, CANVAS_AREA, AREA_MAX.body)).toBe(0);
    expect(areaScore(100, 0, AREA_MAX.body)).toBe(0);
  });
});

describe('colorBonus（いろを たくさん つかうと ちょっと つよい）', () => {
  it('1色ならボーナスなし', () => {
    expect(colorBonus(1)).toBe(1);
  });

  it('色が増えるごとに2%ずつ増える', () => {
    expect(colorBonus(2)).toBeCloseTo(1.02);
    expect(colorBonus(4)).toBeCloseTo(1.06);
  });

  it('最大でも+10%で頭打ち', () => {
    expect(colorBonus(6)).toBeCloseTo(1.1);
    expect(colorBonus(12)).toBeCloseTo(1.1);
  });
});

describe('computeStats', () => {
  it('何も描いていない状態が各ステータスの下限になる', () => {
    const stats = computeStats(input({}));
    expect(stats.maxHp).toBe(60);
    expect(stats.atk).toBe(10);
    expect(stats.spd).toBe(5);
  });

  it('想定上限まで塗ると各ステータスの上限になる', () => {
    const stats = computeStats(
      input({ bodyRatio: AREA_MAX.body, armsRatio: AREA_MAX.arms, legsRatio: AREA_MAX.legs }),
    );
    expect(stats.maxHp).toBe(150);
    expect(stats.atk).toBe(40);
    expect(stats.spd).toBe(25);
  });

  it('からだは体力、うでは攻撃力、あしは素早さだけに影響する', () => {
    const bodyOnly = computeStats(input({ bodyRatio: AREA_MAX.body }));
    expect(bodyOnly.maxHp).toBe(150);
    expect(bodyOnly.atk).toBe(10);
    expect(bodyOnly.spd).toBe(5);

    const armsOnly = computeStats(input({ armsRatio: AREA_MAX.arms }));
    expect(armsOnly.maxHp).toBe(60);
    expect(armsOnly.atk).toBe(40);

    const legsOnly = computeStats(input({ legsRatio: AREA_MAX.legs }));
    expect(legsOnly.spd).toBe(25);
  });

  it('色ボーナスが全ステータスに掛かる', () => {
    const stats = computeStats(input({ colorCount: 6 }));
    expect(stats.maxHp).toBe(Math.round(60 * 1.1));
    expect(stats.atk).toBe(Math.round(10 * 1.1));
    expect(stats.spd).toBe(Math.round(5 * 1.1));
  });

  it('属性はあたまの形だけで決まる', () => {
    expect(computeStats(input({ headAspect: 2 })).element).toBe('scissors');
    expect(computeStats(input({ headAspect: 1, headDensity: 0.8 })).element).toBe('rock');
    expect(computeStats(input({ headAspect: 1, headDensity: 0.2 })).element).toBe('paper');
  });

  it('同じ絵からは必ず同じステータスが出る', () => {
    const source = input({ bodyRatio: 0.11, armsRatio: 0.04, legsRatio: 0.07, colorCount: 3 });
    expect(computeStats(source)).toEqual(computeStats(source));
  });
});

describe('applyMultiplier（勝つたびの1.5倍強化）', () => {
  it('全ステータスが1.5倍になる', () => {
    const base = { maxHp: 100, atk: 20, spd: 10, element: 'rock' as const };
    expect(applyMultiplier(base, 1.5)).toEqual({ maxHp: 150, atk: 30, spd: 15, element: 'rock' });
  });

  it('属性は倍率の影響を受けない', () => {
    const base = { maxHp: 100, atk: 20, spd: 10, element: 'paper' as const };
    expect(applyMultiplier(base, 5.0625).element).toBe('paper');
  });

  it('5連勝ぶん強化すると約5.06倍になる', () => {
    const base = { maxHp: 100, atk: 20, spd: 10, element: 'rock' as const };
    const multiplier = 1.5 ** 4;
    expect(applyMultiplier(base, multiplier).maxHp).toBe(506);
  });

  it('小さい値でも1未満にはならない', () => {
    const base = { maxHp: 1, atk: 1, spd: 1, element: 'rock' as const };
    expect(applyMultiplier(base, 0.01).atk).toBe(1);
  });
});

describe('starsFor（星の数）', () => {
  it('下限は星1つ、上限は星5つ', () => {
    expect(starsFor(60, 'maxHp')).toBe(1);
    expect(starsFor(150, 'maxHp')).toBe(5);
    expect(starsFor(10, 'atk')).toBe(1);
    expect(starsFor(40, 'atk')).toBe(5);
  });

  it('強化して範囲を超えても星5つで頭打ちになる', () => {
    expect(starsFor(900, 'maxHp')).toBe(5);
  });

  it('まん中あたりは星3つ', () => {
    expect(starsFor(105, 'maxHp')).toBe(3);
  });
});
