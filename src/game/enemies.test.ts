import { describe, expect, it } from 'vitest';
import {
  ENEMIES,
  NORMAL_ENEMIES,
  STRONG_ENEMIES,
  STRONG_RATIO,
  enemyById,
  enemyStatsFor,
  scaleStats,
  strongEnemyOf,
  strongStatsFor,
} from './enemies';
import { ELEMENTS } from './element';
import type { Stats } from './stats';

const PLAYER: Stats = { maxHp: 110, atk: 30, spd: 15, element: 'rock' };

describe('敵の一覧', () => {
  it('通常6種＋強敵3種の全9種', () => {
    expect(NORMAL_ENEMIES).toHaveLength(6);
    expect(STRONG_ENEMIES).toHaveLength(3);
    expect(ENEMIES).toHaveLength(9);
  });

  it('idが重複していない', () => {
    const ids = ENEMIES.map((enemy) => enemy.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('強敵はグー・チョキ・パーが1体ずつ', () => {
    for (const element of ELEMENTS) {
      expect(STRONG_ENEMIES.filter((enemy) => enemy.element === element)).toHaveLength(1);
      expect(strongEnemyOf(element).element).toBe(element);
    }
  });

  it('通常敵は固定ステータスを持ち、強敵は持たない', () => {
    for (const enemy of NORMAL_ENEMIES) {
      expect(enemy.baseStats).toBeDefined();
      expect(enemy.baseStats?.element).toBe(enemy.element);
    }
    for (const enemy of STRONG_ENEMIES) {
      expect(enemy.baseStats).toBeUndefined();
    }
  });

  it('どの敵も4パーツぶんの描画データを持っている', () => {
    for (const enemy of ENEMIES) {
      const parts = new Set(enemy.doc.ops.map((op) => op.part));
      expect([...parts].sort()).toEqual(['arms', 'body', 'head', 'legs']);
      expect(enemy.doc.currentStep).toBe('done');
    }
  });

  it('しらないidを引くとエラーになる', () => {
    expect(() => enemyById('nope')).toThrow();
    expect(enemyById('golem').name).toBe('ゴロン');
  });
});

describe('強敵のステータス生成', () => {
  it('1戦目時点でプレイヤーの1.2倍になる', () => {
    const stats = strongStatsFor(PLAYER, 'paper');
    expect(stats.maxHp).toBe(Math.round(110 * STRONG_RATIO));
    expect(stats.atk).toBe(Math.round(30 * STRONG_RATIO));
    expect(stats.spd).toBe(Math.round(15 * STRONG_RATIO));
  });

  it('属性はプレイヤーではなく強敵キャラのものになる', () => {
    expect(strongStatsFor(PLAYER, 'paper').element).toBe('paper');
    expect(strongStatsFor(PLAYER, 'scissors').element).toBe('scissors');
  });

  it('絵が大きいほど強敵も強くなる', () => {
    const small = strongStatsFor({ ...PLAYER, maxHp: 60 }, 'rock');
    const large = strongStatsFor({ ...PLAYER, maxHp: 150 }, 'rock');
    expect(large.maxHp).toBeGreaterThan(small.maxHp);
  });
});

describe('連勝によるスケーリング', () => {
  it('1.0倍なら変化しない', () => {
    const base: Stats = { maxHp: 100, atk: 20, spd: 10, element: 'rock' };
    expect(scaleStats(base, 1)).toEqual(base);
  });

  it('倍率が掛かるが属性は変わらない', () => {
    const scaled = scaleStats({ maxHp: 100, atk: 20, spd: 10, element: 'paper' }, 1.1);
    expect(scaled).toEqual({ maxHp: 110, atk: 22, spd: 11, element: 'paper' });
  });

  it('1未満にはならない', () => {
    expect(scaleStats({ maxHp: 1, atk: 1, spd: 1, element: 'rock' }, 0.01).atk).toBe(1);
  });
});

describe('enemyStatsFor', () => {
  it('通常敵は固定ステータスにスケールを掛ける', () => {
    const golem = enemyById('golem');
    const base = golem.baseStats as Stats;
    expect(enemyStatsFor(golem, PLAYER, 1)).toEqual(base);
    expect(enemyStatsFor(golem, PLAYER, 1.1).maxHp).toBe(Math.round(base.maxHp * 1.1));
  });

  it('通常敵はプレイヤーの強さに影響されない', () => {
    const golem = enemyById('golem');
    const weak = enemyStatsFor(golem, { ...PLAYER, maxHp: 60, atk: 10 }, 1);
    const strong = enemyStatsFor(golem, { ...PLAYER, maxHp: 150, atk: 44 }, 1);
    expect(weak).toEqual(strong);
  });

  it('強敵はプレイヤー基準にスケールを掛ける', () => {
    const king = strongEnemyOf('paper');
    const first = enemyStatsFor(king, PLAYER, 1);
    expect(first.maxHp).toBe(Math.round(110 * STRONG_RATIO));

    // 5戦目は 1.1 の4乗
    const final = enemyStatsFor(king, PLAYER, 1.1 ** 4);
    expect(final.maxHp).toBe(Math.round(Math.round(110 * STRONG_RATIO) * 1.1 ** 4));
    expect(final.maxHp).toBeGreaterThan(first.maxHp);
  });

  it('5戦目の強敵は、全勝KOで来たプレイヤーとほぼ互角になる', () => {
    // プレイヤー: 4連勝すべて3回以内KO → 成長率 1.8
    const player = Math.round(PLAYER.maxHp * 1.8);
    const boss = enemyStatsFor(strongEnemyOf('rock'), PLAYER, 1.1 ** 4).maxHp;
    expect(boss / player).toBeGreaterThan(0.9);
    expect(boss / player).toBeLessThan(1.1);
  });
});
