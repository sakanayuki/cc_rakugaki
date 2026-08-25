import { describe, expect, it } from 'vitest';
import {
  Battle,
  EARLY_UNLOCK_ROUNDS,
  MAX_ROUNDS,
  dodgeChance,
  isDisadvantaged,
  specialUnlockRound,
} from './battleEngine';
import type { BattleEvent, Combatant } from './battleEngine';
import type { RNG } from './rng';
import { seededRng } from './rng';
import type { Stats } from './stats';

/** 指定した値を順番に返し続けるRNG。1回の攻撃で 回避→防御→会心→ゆらぎ の4回消費される */
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

/** 回避も防御も会心もせず、ダメージのゆらぎが 1.147 倍になるRNG */
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
    const battle = new Battle(fighter('p', { spd: 5 }), fighter('e', { spd: 9 }), { rng: NEVER_AVOID });
    expect(battle.firstMover).toBe('enemy');
  });

  it('同じ素早さならプレイヤーが先攻', () => {
    const battle = new Battle(fighter('p', { spd: 7 }), fighter('e', { spd: 7 }), { rng: NEVER_AVOID });
    expect(battle.firstMover).toBe('player');
  });

  it('開始イベントに先攻が記録される', () => {
    const battle = new Battle(fighter('p', { spd: 30 }), fighter('e', { spd: 1 }), { rng: NEVER_AVOID });
    const [first] = battle.run();
    expect(first).toEqual({ type: 'start', first: 'player', specialUnlockRound: MAX_ROUNDS });
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
      fighter('e', { spd: 1, atk: 1, element: 'scissors' }), { rng: fixedRng([0.99]) });
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
      fighter('e', { spd: 1, atk: 1, element: 'paper' }), { rng: fixedRng([0.99]) });
    const first = attacks(battle.run())[0];
    expect(first.elementMul).toBe(0.5);
    expect(first.damage).toBe(Math.round(20 * 0.5 * VARIANCE));
  });

  it('防御されるとダメージが半分になる', () => {
    // 回避しない(0.99) → 防御する(0.05) → 会心しない(0.5) → ゆらぎ1.0(0.5)
    const battle = new Battle(
      fighter('p', { atk: 20, spd: 10 }),
      fighter('e', { spd: 1, atk: 1 }), { rng: fixedRng([0.99, 0.05, 0.5, 0.5]) });
    const first = attacks(battle.run())[0];
    expect(first.result).toBe('guard');
    expect(first.critical).toBe(false);
    expect(first.damage).toBe(10);
  });

  it('回避されるとダメージ0でHPが減らない', () => {
    const battle = new Battle(
      fighter('p', { atk: 20, spd: 10 }),
      fighter('e', { spd: 1, atk: 1, maxHp: 500 }), { rng: ALWAYS_DODGE });
    const first = attacks(battle.run())[0];
    expect(first.result).toBe('dodge');
    expect(first.damage).toBe(0);
    expect(first.hpAfter).toBe(500);
  });

  it('ダメージは最低でも1', () => {
    const battle = new Battle(
      fighter('p', { atk: 1, spd: 10, element: 'rock' }),
      fighter('e', { spd: 1, atk: 1, element: 'paper' }), { rng: fixedRng([0.99]) });
    const first = attacks(battle.run())[0];
    expect(first.damage).toBeGreaterThanOrEqual(1);
  });
});

describe('必殺技（3往復して決着がつかない場合）', () => {
  it('互いに3回ずつ攻撃したあと必殺技が解禁される', () => {
    const battle = new Battle(fighter('p'), fighter('e', { spd: 1 }), { rng: ALWAYS_DODGE });
    const events = battle.run();

    expect(attacks(events)).toHaveLength(MAX_ROUNDS * 2);
    expect(events[events.length - 1]).toEqual({ type: 'specialReady' });
    expect(battle.state).toBe('awaitingSpecial');
  });

  it('必殺技はNPCを一撃で倒す', () => {
    const battle = new Battle(fighter('p'), fighter('e', { spd: 1, maxHp: 777 }), { rng: ALWAYS_DODGE });
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
      fighter('e', { maxHp: 1, spd: 1 }), { rng: NEVER_AVOID });
    battle.run();
    expect(() => battle.useSpecial()).toThrow();
  });

  it('解禁前に必殺技を使おうとするとエラーになる', () => {
    const battle = new Battle(fighter('p'), fighter('e'), { rng: NEVER_AVOID });
    expect(() => battle.useSpecial()).toThrow();
  });
});

describe('決着', () => {
  it('HPが0になった時点で戦闘が終わる', () => {
    const battle = new Battle(
      fighter('p', { atk: 999, spd: 50 }),
      fighter('e', { maxHp: 1, spd: 1 }), { rng: NEVER_AVOID });
    const events = battle.run();

    expect(attacks(events)).toHaveLength(1);
    expect(events[events.length - 1]).toEqual({ type: 'end', winner: 'player' });
    expect(battle.enemyHp).toBe(0);
  });

  it('プレイヤーが倒れると敵の勝ちになる', () => {
    const battle = new Battle(
      fighter('p', { maxHp: 10, atk: 1, spd: 1 }),
      fighter('e', { atk: 100, spd: 50 }), { rng: NEVER_AVOID });
    const events = battle.run();

    expect(events[events.length - 1]).toEqual({ type: 'end', winner: 'enemy' });
    expect(battle.playerHp).toBe(0);
  });

  it('同じ戦闘を二度は開始できない', () => {
    const battle = new Battle(fighter('p'), fighter('e'), { rng: NEVER_AVOID });
    battle.run();
    expect(() => battle.run()).toThrow();
  });
});

describe('再現性', () => {
  it('同じシードなら同じ結果になる', () => {
    const build = () =>
      new Battle(
        fighter('p', { atk: 25, spd: 12, element: 'scissors' }),
        fighter('e', { atk: 22, spd: 14, element: 'paper', maxHp: 120 }), { rng: seededRng(1234) }).run();

    expect(build()).toEqual(build());
  });
});

describe('会心の一撃', () => {
  it('10%を引くとダメージが2倍になる', () => {
    // 回避しない(0.99) → 防御しない(0.99) → 会心する(0.05) → ゆらぎ1.0(0.5)
    const battle = new Battle(
      fighter('p', { atk: 20, spd: 10 }),
      fighter('e', { spd: 1, atk: 1 }),
      { rng: fixedRng([0.99, 0.99, 0.05, 0.5]) },
    );
    const first = attacks(battle.run())[0];
    expect(first.critical).toBe(true);
    expect(first.damage).toBe(40);
  });

  it('属性の倍率と掛け算で重なる（最大4倍）', () => {
    const battle = new Battle(
      fighter('p', { atk: 20, spd: 10, element: 'rock' }),
      fighter('e', { spd: 1, atk: 1, element: 'scissors' }),
      { rng: fixedRng([0.99, 0.99, 0.05, 0.5]) },
    );
    const first = attacks(battle.run())[0];
    expect(first.elementMul).toBe(2);
    expect(first.critical).toBe(true);
    expect(first.damage).toBe(80);
  });

  it('ぼうぎょされると会心でも半減する', () => {
    // 回避しない → 防御する(0.05) → 会心する(0.05) → ゆらぎ1.0(0.5)
    const battle = new Battle(
      fighter('p', { atk: 20, spd: 10 }),
      fighter('e', { spd: 1, atk: 1 }),
      { rng: fixedRng([0.99, 0.05, 0.05, 0.5]) },
    );
    const first = attacks(battle.run())[0];
    expect(first.result).toBe('guard');
    expect(first.critical).toBe(true);
    expect(first.damage).toBe(20);
  });

  it('回避されたら会心は発生しない', () => {
    const battle = new Battle(fighter('p'), fighter('e', { spd: 1 }), { rng: ALWAYS_DODGE });
    for (const attack of attacks(battle.run())) {
      expect(attack.result).toBe('dodge');
      expect(attack.critical).toBe(false);
    }
  });

  it('NPC側にも発生する', () => {
    const battle = new Battle(
      fighter('p', { atk: 1, spd: 1, maxHp: 1000 }),
      fighter('e', { atk: 20, spd: 50, maxHp: 1000 }),
      { rng: fixedRng([0.99, 0.99, 0.05, 0.5]) },
    );
    const first = attacks(battle.run())[0];
    expect(first.actor).toBe('enemy');
    expect(first.critical).toBe(true);
    expect(first.damage).toBe(40);
  });
});

describe('相性と必殺技の解禁ラウンド', () => {
  it('相手の攻撃が2倍になる関係を「不利」と判定する', () => {
    // パーはグーに強い → プレイヤーがグーなら、パーの相手は不利
    expect(isDisadvantaged('rock', 'paper')).toBe(true);
    expect(isDisadvantaged('scissors', 'rock')).toBe(true);
    expect(isDisadvantaged('paper', 'scissors')).toBe(true);
  });

  it('互角・有利な相手は不利ではない', () => {
    expect(isDisadvantaged('rock', 'rock')).toBe(false);
    expect(isDisadvantaged('rock', 'scissors')).toBe(false);
  });

  it('通常の試合は3往復で解禁される', () => {
    expect(specialUnlockRound('rock', 'paper', false)).toBe(MAX_ROUNDS);
    expect(specialUnlockRound('rock', 'rock', false)).toBe(MAX_ROUNDS);
  });

  it('最終戦で不利属性のときだけ2往復に早まる', () => {
    expect(specialUnlockRound('rock', 'paper', true)).toBe(EARLY_UNLOCK_ROUNDS);
    expect(specialUnlockRound('rock', 'rock', true)).toBe(MAX_ROUNDS);
    expect(specialUnlockRound('rock', 'scissors', true)).toBe(MAX_ROUNDS);
  });

  it('解禁ラウンド数を短くすると、その回数で必殺技が使えるようになる', () => {
    const battle = new Battle(fighter('p'), fighter('e', { spd: 1 }), {
      rng: ALWAYS_DODGE,
      specialUnlockRound: EARLY_UNLOCK_ROUNDS,
    });
    const events = battle.run();

    expect(attacks(events)).toHaveLength(EARLY_UNLOCK_ROUNDS * 2);
    expect(events[0]).toEqual({
      type: 'start',
      first: 'player',
      specialUnlockRound: EARLY_UNLOCK_ROUNDS,
    });
    expect(events[events.length - 1]).toEqual({ type: 'specialReady' });
  });
});
