import { describe, expect, it } from 'vitest';
import { Battle, MAX_ROUNDS, dodgeChance } from './battleEngine';
import type { BattleEvent, Combatant } from './battleEngine';
import type { RNG } from './rng';
import { seededRng } from './rng';
import type { Stats } from './stats';

/** 指定した値を順番に返し続けるRNG。1回の攻撃で 回避・防御・ゆらぎ の3回消費される */
function fixedRng(values: number[]): RNG {
  let index = 0;
  return {
    next() {
      const value = values[index % values.length];
      index++;
      return value;
    },
  };
}

/** 回避も防御もせず、ダメージのゆらぎが 1.147 倍になるRNG */
const NEVER_AVOID = fixedRng([0.99]);
/** 必ず回避するRNG */
const ALWAYS_DODGE = fixedRng([0]);
const VARIANCE = 0.85 + 0.99 * 0.3;

function stats(overrides: Partial<Stats> = {}): Stats {
  return { maxHp: 1000, atk: 20, spd: 10, element: 'rock', ...overrides };
}

function fighter(name: string, overrides: Partial<Stats> = {}): Combatant {
  return { name, stats: stats(overrides) };
}

function attacks(events: BattleEvent[]) {
  return events.filter((event): event is Extract<BattleEvent, { type: 'attack' }> => event.type === 'attack');
}

describe('先攻の決定', () => {
  it('素早さが高いほうが先攻', () => {
    const battle = new Battle(fighter('p', { spd: 5 }), fighter('e', { spd: 9 }), NEVER_AVOID);
    expect(battle.firstMover).toBe('enemy');
  });

  it('同じ素早さならプレイヤーが先攻', () => {
    const battle = new Battle(fighter('p', { spd: 7 }), fighter('e', { spd: 7 }), NEVER_AVOID);
    expect(battle.firstMover).toBe('player');
  });

  it('開始イベントに先攻が記録される', () => {
    const battle = new Battle(fighter('p', { spd: 30 }), fighter('e', { spd: 1 }), NEVER_AVOID);
    const [first] = battle.run();
    expect(first).toEqual({ type: 'start', first: 'player' });
  });
});

describe('回避率', () => {
  it('素早さが同じなら下限の5%', () => {
    expect(dodgeChance(10, 10)).toBe(5);
  });

  it('守る側が速いほど上がるが25%で頭打ち', () => {
    expect(dodgeChance(10, 20)).toBe(15);
    expect(dodgeChance(10, 90)).toBe(25);
  });

  it('攻める側が速くても5%を下回らない', () => {
    expect(dodgeChance(90, 10)).toBe(5);
  });
});

describe('ダメージの解決', () => {
  it('属性で有利なら2倍のダメージになる', () => {
    const battle = new Battle(
      fighter('p', { atk: 20, spd: 10, element: 'rock' }),
      fighter('e', { spd: 1, atk: 1, element: 'scissors' }),
      fixedRng([0.99]),
    );
    const first = attacks(battle.run())[0];
    expect(first.actor).toBe('player');
    expect(first.result).toBe('hit');
    expect(first.elementMul).toBe(2);
    expect(first.damage).toBe(Math.round(20 * 2 * VARIANCE));
    expect(first.hpAfter).toBe(1000 - first.damage);
  });

  it('属性で不利なら半分のダメージになる', () => {
    const battle = new Battle(
      fighter('p', { atk: 20, spd: 10, element: 'rock' }),
      fighter('e', { spd: 1, atk: 1, element: 'paper' }),
      fixedRng([0.99]),
    );
    const first = attacks(battle.run())[0];
    expect(first.elementMul).toBe(0.5);
    expect(first.damage).toBe(Math.round(20 * 0.5 * VARIANCE));
  });

  it('防御されるとダメージが半分になる', () => {
    // 回避しない(0.99) → 防御する(0.05) → ゆらぎ1.0(0.5)
    const battle = new Battle(
      fighter('p', { atk: 20, spd: 10 }),
      fighter('e', { spd: 1, atk: 1 }),
      fixedRng([0.99, 0.05, 0.5]),
    );
    const first = attacks(battle.run())[0];
    expect(first.result).toBe('guard');
    expect(first.damage).toBe(10);
  });

  it('回避されるとダメージ0でHPが減らない', () => {
    const battle = new Battle(
      fighter('p', { atk: 20, spd: 10 }),
      fighter('e', { spd: 1, atk: 1, maxHp: 500 }),
      ALWAYS_DODGE,
    );
    const first = attacks(battle.run())[0];
    expect(first.result).toBe('dodge');
    expect(first.damage).toBe(0);
    expect(first.hpAfter).toBe(500);
  });

  it('ダメージは最低でも1', () => {
    const battle = new Battle(
      fighter('p', { atk: 1, spd: 10, element: 'rock' }),
      fighter('e', { spd: 1, atk: 1, element: 'paper' }),
      fixedRng([0.99]),
    );
    const first = attacks(battle.run())[0];
    expect(first.damage).toBeGreaterThanOrEqual(1);
  });
});

describe('必殺技（3往復して決着がつかない場合）', () => {
  it('互いに3回ずつ攻撃したあと必殺技が解禁される', () => {
    const battle = new Battle(fighter('p'), fighter('e', { spd: 1 }), ALWAYS_DODGE);
    const events = battle.run();

    expect(attacks(events)).toHaveLength(MAX_ROUNDS * 2);
    expect(events[events.length - 1]).toEqual({ type: 'specialReady' });
    expect(battle.state).toBe('awaitingSpecial');
  });

  it('必殺技はNPCを一撃で倒す', () => {
    const battle = new Battle(fighter('p'), fighter('e', { spd: 1, maxHp: 777 }), ALWAYS_DODGE);
    battle.run();
    const events = battle.useSpecial();

    expect(events[0]).toEqual({ type: 'special', damage: 777, hpAfter: 0 });
    expect(events[1]).toEqual({ type: 'end', winner: 'player' });
    expect(battle.enemyHp).toBe(0);
    expect(battle.state).toBe('ended');
  });

  it('決着がついた戦闘では必殺技は使えない', () => {
    const battle = new Battle(
      fighter('p', { atk: 999, spd: 50 }),
      fighter('e', { maxHp: 1, spd: 1 }),
      NEVER_AVOID,
    );
    battle.run();
    expect(() => battle.useSpecial()).toThrow();
  });

  it('解禁前に必殺技を使おうとするとエラーになる', () => {
    const battle = new Battle(fighter('p'), fighter('e'), NEVER_AVOID);
    expect(() => battle.useSpecial()).toThrow();
  });
});

describe('決着', () => {
  it('HPが0になった時点で戦闘が終わる', () => {
    const battle = new Battle(
      fighter('p', { atk: 999, spd: 50 }),
      fighter('e', { maxHp: 1, spd: 1 }),
      NEVER_AVOID,
    );
    const events = battle.run();

    expect(attacks(events)).toHaveLength(1);
    expect(events[events.length - 1]).toEqual({ type: 'end', winner: 'player' });
    expect(battle.enemyHp).toBe(0);
  });

  it('プレイヤーが倒れると敵の勝ちになる', () => {
    const battle = new Battle(
      fighter('p', { maxHp: 10, atk: 1, spd: 1 }),
      fighter('e', { atk: 100, spd: 50 }),
      NEVER_AVOID,
    );
    const events = battle.run();

    expect(events[events.length - 1]).toEqual({ type: 'end', winner: 'enemy' });
    expect(battle.playerHp).toBe(0);
  });

  it('同じ戦闘を二度は開始できない', () => {
    const battle = new Battle(fighter('p'), fighter('e'), NEVER_AVOID);
    battle.run();
    expect(() => battle.run()).toThrow();
  });
});

describe('再現性', () => {
  it('同じシードなら同じ結果になる', () => {
    const build = () =>
      new Battle(
        fighter('p', { atk: 25, spd: 12, element: 'scissors' }),
        fighter('e', { atk: 22, spd: 14, element: 'paper', maxHp: 120 }),
        seededRng(1234),
      ).run();

    expect(build()).toEqual(build());
  });
});
