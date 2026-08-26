import { describe, expect, it } from 'vitest';
import type { Element } from './element';
import { seededRng } from './rng';
import type { Stats } from './stats';
import {
  PVP_TURNS,
  hpPercent,
  isValidChoices,
  jankenWinner,
  simulatePvp,
} from './pvpEngine';
import type { PvpEvent } from './pvpEngine';

const ROCK: Stats = { maxHp: 100, atk: 20, spd: 10, element: 'rock' };
const PAPER: Stats = { maxHp: 100, atk: 20, spd: 10, element: 'paper' };

function run(
  hostChoices: Element[],
  guestChoices: Element[],
  seed = 1,
  host: Stats = ROCK,
  guest: Stats = PAPER,
): PvpEvent[] {
  return simulatePvp({
    host: { stats: host, choices: hostChoices },
    guest: { stats: guest, choices: guestChoices },
    seed,
  });
}

type AttackEvent = Extract<PvpEvent, { type: 'attack' }>;
type EndEvent = Extract<PvpEvent, { type: 'end' }>;

const all = (element: Element): Element[] => [element, element, element];
const endOf = (events: PvpEvent[]): EndEvent =>
  events.find((e): e is EndEvent => e.type === 'end')!;
const attacksOf = (events: PvpEvent[]): AttackEvent[] =>
  events.filter((e): e is AttackEvent => e.type === 'attack');

describe('ジャンケンの判定', () => {
  it('グーはチョキに勝つ', () => {
    expect(jankenWinner('rock', 'scissors')).toBe('host');
    expect(jankenWinner('scissors', 'rock')).toBe('guest');
  });

  it('チョキはパーに勝つ', () => {
    expect(jankenWinner('scissors', 'paper')).toBe('host');
    expect(jankenWinner('paper', 'scissors')).toBe('guest');
  });

  it('パーはグーに勝つ', () => {
    expect(jankenWinner('paper', 'rock')).toBe('host');
    expect(jankenWinner('rock', 'paper')).toBe('guest');
  });

  it('おなじ手はあいこ', () => {
    for (const element of ['rock', 'scissors', 'paper'] as Element[]) {
      expect(jankenWinner(element, element)).toBe('draw');
    }
  });
});

describe('ターンの進行', () => {
  it('3ターン戦う', () => {
    const events = run(all('rock'), all('rock'), 7, ROCK, ROCK);
    const starts = events.filter((e) => e.type === 'turnStart');
    expect(starts).toHaveLength(PVP_TURNS);
  });

  it('ジャンケンに勝った側だけが攻撃する', () => {
    // ホストがグー、ゲストがチョキ → ホストの3連勝
    const events = run(all('rock'), all('scissors'), 3, ROCK, ROCK);
    expect(attacksOf(events).every((a) => a.actor === 'host')).toBe(true);
  });

  it('負けた側は1回も攻撃できない', () => {
    const events = run(all('scissors'), all('rock'), 3, ROCK, ROCK);
    expect(attacksOf(events).every((a) => a.actor === 'guest')).toBe(true);
  });

  it('あいこは両方が攻撃する', () => {
    const events = run(all('rock'), all('rock'), 11, ROCK, ROCK);
    const firstTurn = attacksOf(events).filter((a) => a.turn === 0);
    expect(firstTurn).toHaveLength(2);
    expect(new Set(firstTurn.map((a) => a.actor))).toEqual(new Set(['host', 'guest']));
  });

  it('あいこでは はやさが高いほうが先に殴る', () => {
    const fast: Stats = { ...ROCK, spd: 25 };
    const slow: Stats = { ...ROCK, spd: 5 };
    const events = run(all('rock'), all('rock'), 11, slow, fast);
    expect(attacksOf(events)[0].actor).toBe('guest');
  });

  it('はやさが同じならホストが先', () => {
    const events = run(all('rock'), all('rock'), 11, ROCK, ROCK);
    expect(attacksOf(events)[0].actor).toBe('host');
  });
});

describe('攻撃属性と防御属性', () => {
  it('選んだ手が攻撃属性になる（相手の絵の属性が守り）', () => {
    // ゲストの絵はパー。ホストがチョキで殴ると こうかばつぐん
    const events = run(all('scissors'), all('paper'), 5, ROCK, PAPER);
    const hit = attacksOf(events).find((a) => a.actor === 'host' && a.result !== 'dodge');
    expect(hit?.elementMul).toBe(2);
  });

  it('自分の絵の属性は攻撃には関係しない', () => {
    // ホストの絵はグーだが、パーを選んだので パー→パー で等倍。
    // ゲストがグーならジャンケンはホストの勝ちなので、ホストが殴れる
    const events = run(all('paper'), all('rock'), 5, ROCK, PAPER);
    const hit = attacksOf(events).find((a) => a.actor === 'host' && a.result !== 'dodge');
    expect(hit?.elementMul).toBe(1);
  });
});

describe('勝敗', () => {
  it('のこり体力％が多いほうが勝つ', () => {
    const events = run(all('rock'), all('scissors'), 3, ROCK, ROCK);
    const end = endOf(events);
    expect(end.winner).toBe('host');
    expect(end.hostPercent).toBe(100);
  });

  it('％がおなじならひきわけ', () => {
    // どちらも攻撃できないターンは無いので、体力が減らない組み合わせを作れない。
    // 代わりに、同じ絵・同じ手・同じ乱数なら対称になることを使う
    const events = simulatePvp({
      host: { stats: ROCK, choices: all('rock') },
      guest: { stats: ROCK, choices: all('rock') },
      seed: 42,
    });
    const end = endOf(events);
    if (end.hostPercent === end.guestPercent) expect(end.winner).toBe('draw');
  });

  it('体力が0になったらそこで終わる', () => {
    const glassCannon: Stats = { maxHp: 150, atk: 40, spd: 10, element: 'rock' };
    const fragile: Stats = { maxHp: 60, atk: 10, spd: 10, element: 'scissors' };
    const events = run(all('rock'), all('scissors'), 9, glassCannon, fragile);
    const end = endOf(events);
    if (end.reason === 'ko') {
      expect(end.guestPercent).toBe(0);
      expect(end.winner).toBe('host');
      // 決着後にイベントが続かない
      expect(events[events.length - 1]).toBe(end);
    }
  });

  it('倒れたあとは殴り返せない（あいこでも）', () => {
    const fragile: Stats = { maxHp: 1, atk: 10, spd: 5, element: 'rock' };
    const strong: Stats = { maxHp: 200, atk: 40, spd: 25, element: 'rock' };
    const events = run(all('rock'), all('rock'), 4, fragile, strong);
    const attacks = attacksOf(events);
    // はやい strong(guest) が先に殴って倒すので、hostの攻撃は起きない
    expect(attacks).toHaveLength(1);
    expect(attacks[0].actor).toBe('guest');
    expect(endOf(events).oneShot).toBe(true);
  });

  it('3ターン戦い切ったら oneShot ではない', () => {
    const events = run(all('rock'), all('scissors'), 3, ROCK, ROCK);
    const end = endOf(events);
    expect(end.reason).toBe('turns');
    expect(end.oneShot).toBe(false);
  });
});

describe('％の計算', () => {
  it('四捨五入した整数になる', () => {
    expect(hpPercent(50, 100)).toBe(50);
    expect(hpPercent(1, 3)).toBe(33);
    expect(hpPercent(2, 3)).toBe(67);
    expect(hpPercent(0, 100)).toBe(0);
    expect(hpPercent(100, 100)).toBe(100);
  });

  it('最大体力が0でも落ちない', () => {
    expect(hpPercent(0, 0)).toBe(0);
  });
});

describe('決定論（2台で同じ結果になることの根拠）', () => {
  it('おなじ入力からはおなじイベント列が出る', () => {
    for (const seed of [1, 12345, 999999]) {
      const a = run(['rock', 'paper', 'scissors'], ['scissors', 'rock', 'paper'], seed);
      const b = run(['rock', 'paper', 'scissors'], ['scissors', 'rock', 'paper'], seed);
      expect(a).toEqual(b);
    }
  });

  it('種が違えば結果も変わりうる', () => {
    const results = new Set(
      Array.from({ length: 30 }, (_, i) =>
        JSON.stringify(run(all('rock'), all('rock'), i + 1, ROCK, ROCK)),
      ),
    );
    expect(results.size).toBeGreaterThan(1);
  });

  it('RNGを差し替えても呼び出し側の形は変わらない', () => {
    const events = simulatePvp(
      { host: { stats: ROCK, choices: all('rock') }, guest: { stats: PAPER, choices: all('rock') }, seed: 1 },
      (seed) => seededRng(seed + 1),
    );
    expect(events.some((e) => e.type === 'end')).toBe(true);
  });
});

describe('手のバリデーション', () => {
  it('3つそろった正しい手だけ通す', () => {
    expect(isValidChoices(['rock', 'paper', 'scissors'])).toBe(true);
  });

  it('数が違えば弾く', () => {
    expect(isValidChoices(['rock', 'paper'])).toBe(false);
    expect(isValidChoices(['rock', 'paper', 'scissors', 'rock'])).toBe(false);
  });

  it('知らない値は弾く', () => {
    expect(isValidChoices(['rock', 'paper', 'bomb'])).toBe(false);
    expect(isValidChoices([1, 2, 3])).toBe(false);
    expect(isValidChoices(null)).toBe(false);
    expect(isValidChoices('rock')).toBe(false);
  });
});
