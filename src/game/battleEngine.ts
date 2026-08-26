/**
 * 戦闘ロジック。UI・Three.js に依存せず、イベント列を生成するだけにしてある。
 * 画面側はこのイベントを順番に演出として再生する。
 */

import type { Element } from './element';
import { elementMultiplier } from './element';
import type { RNG } from './rng';
import { randRange, systemRng } from './rng';
import type { Stats } from './stats';

export type Side = 'player' | 'enemy';

export interface Combatant {
  name: string;
  stats: Stats;
}

export type AttackResult = 'hit' | 'dodge' | 'guard';

export type BattleEvent =
  | { type: 'start'; first: Side; specialUnlockRound: number }
  | {
      type: 'attack';
      actor: Side;
      target: Side;
      result: AttackResult;
      damage: number;
      elementMul: 0.5 | 1 | 2;
      /** 会心の一撃だったか */
      critical: boolean;
      hpAfter: number;
    }
  /** 規定ラウンド戦って決着がつかなかった。ここでプレイヤーの入力を待つ */
  | { type: 'specialReady' }
  | { type: 'special'; damage: number; hpAfter: number }
  | { type: 'end'; winner: Side };

/** 通常、互いに何回攻撃したら必殺技が解禁されるか */
export const MAX_ROUNDS = 3;
/** 不利属性の救済で早められたときのラウンド数 */
export const EARLY_UNLOCK_ROUNDS = 2;
/** 回避率の下限・上限（％） */
export const DODGE_MIN = 5;
export const DODGE_MAX = 25;
/** 防御が発生する確率 */
export const GUARD_CHANCE = 0.15;
/** 会心の一撃が出る確率と、その倍率 */
export const CRIT_CHANCE = 0.1;
export const CRIT_MULTIPLIER = 2;
/** ダメージのゆらぎ */
export const DAMAGE_VARIANCE = { min: 0.85, max: 1.15 } as const;

export type BattleStatus = 'ready' | 'awaitingSpecial' | 'ended';

/** 回避率（％）。素早さの差で決まる */
export function dodgeChance(attackerSpd: number, defenderSpd: number): number {
  return Math.max(DODGE_MIN, Math.min(DODGE_MAX, DODGE_MIN + (defenderSpd - attackerSpd)));
}

/** その相手はプレイヤーにとって不利か（相手の攻撃が2倍になる関係か） */
export function isDisadvantaged(playerElement: Element, enemyElement: Element): boolean {
  return elementMultiplier(enemyElement, playerElement) === 2;
}

/**
 * 必殺技が解禁されるまでのラウンド数。
 * 最終戦で不利属性を引いた場合だけ早める（そのままでは勝率がほぼ0になるため）。
 */
export function specialUnlockRound(
  playerElement: Element,
  enemyElement: Element,
  isFinalBattle: boolean,
): number {
  return isFinalBattle && isDisadvantaged(playerElement, enemyElement)
    ? EARLY_UNLOCK_ROUNDS
    : MAX_ROUNDS;
}

export interface BattleOptions {
  rng?: RNG;
  /** 必殺技が解禁されるまでのラウンド数。省略時は MAX_ROUNDS */
  specialUnlockRound?: number;
}

export class Battle {
  readonly player: Combatant;
  readonly enemy: Combatant;
  readonly specialUnlockRound: number;
  playerHp: number;
  enemyHp: number;

  private readonly rng: RNG;
  private status: BattleStatus = 'ready';
  private started = false;

  constructor(player: Combatant, enemy: Combatant, options: BattleOptions = {}) {
    this.player = player;
    this.enemy = enemy;
    this.rng = options.rng ?? systemRng;
    this.specialUnlockRound = options.specialUnlockRound ?? MAX_ROUNDS;
    this.playerHp = player.stats.maxHp;
    this.enemyHp = enemy.stats.maxHp;
  }

  get state(): BattleStatus {
    return this.status;
  }

  /** 素早さが高いほうが先攻。同値ならプレイヤー先攻 */
  get firstMover(): Side {
    return this.player.stats.spd >= this.enemy.stats.spd ? 'player' : 'enemy';
  }

  hpOf(side: Side): number {
    return side === 'player' ? this.playerHp : this.enemyHp;
  }

  combatantOf(side: Side): Combatant {
    return side === 'player' ? this.player : this.enemy;
  }

  /**
   * 戦闘開始から、決着または必殺技解禁までのイベントを一気に生成する。
   * 必殺技解禁で止まった場合は useSpecial() で続きを取得する。
   */
  run(): BattleEvent[] {
    if (this.started) throw new Error('battle already started');
    this.started = true;

    const events: BattleEvent[] = [];
    const first = this.firstMover;
    const second: Side = first === 'player' ? 'enemy' : 'player';
    events.push({ type: 'start', first, specialUnlockRound: this.specialUnlockRound });

    for (let round = 0; round < this.specialUnlockRound; round++) {
      for (const actor of [first, second]) {
        const event = this.resolveAttack(actor);
        events.push(event);
        if (event.hpAfter <= 0) {
          this.status = 'ended';
          events.push({ type: 'end', winner: actor });
          return events;
        }
      }
    }

    // 決着がつかなかった → プレイヤーだけ必殺技が使える
    this.status = 'awaitingSpecial';
    events.push({ type: 'specialReady' });
    return events;
  }

  /** 必殺技。演出のあと必ずNPCを倒す（一撃必殺） */
  useSpecial(): BattleEvent[] {
    if (this.status !== 'awaitingSpecial') {
      throw new Error('special is not available');
    }
    const damage = this.enemyHp;
    this.enemyHp = 0;
    this.status = 'ended';
    return [
      { type: 'special', damage, hpAfter: 0 },
      { type: 'end', winner: 'player' },
    ];
  }

  /** 1回の攻撃を解決してHPに反映する。計算そのものは resolveAttack に任せる */
  private resolveAttack(actor: Side): Extract<BattleEvent, { type: 'attack' }> {
    const target: Side = actor === 'player' ? 'enemy' : 'player';
    const attacker = this.combatantOf(actor).stats;
    const defender = this.combatantOf(target).stats;

    // PvEでは「絵から決まる属性」がそのまま攻撃属性になる
    const outcome = resolveAttack(this.rng, attacker, defender, attacker.element, this.hpOf(target));

    if (target === 'player') this.playerHp = outcome.hpAfter;
    else this.enemyHp = outcome.hpAfter;

    return { type: 'attack', actor, target, ...outcome };
  }
}

export interface AttackOutcome {
  result: AttackResult;
  damage: number;
  elementMul: 0.5 | 1 | 2;
  /** 会心の一撃だったか */
  critical: boolean;
  hpAfter: number;
}

/**
 * 1回の攻撃を解決する。**PvEとオンライン対戦で共有する**。
 *
 * オンライン対戦は2台の端末が同じ計算をして同じ結果になることが前提なので、
 * この式と乱数の消費順（回避 → 防御 → 会心 → ゆらぎ）を別の場所に書き写してはいけない。
 * 片方だけ直すと「2台の画面で結果が違う」という再現しにくいバグになる。
 *
 * @param attackElement 攻撃側の属性。PvEは絵から決まる属性、オンラインは選んだ手
 * @param defenderHp    守備側の現在HP。状態は持たないので呼び出し側が渡す
 */
export function resolveAttack(
  rng: RNG,
  attacker: Stats,
  defender: Stats,
  attackElement: Element,
  defenderHp: number,
): AttackOutcome {
  const elementMul = elementMultiplier(attackElement, defender.element);

  const dodgeRoll = rng.next() * 100;
  if (dodgeRoll < dodgeChance(attacker.spd, defender.spd)) {
    return { result: 'dodge', damage: 0, elementMul, critical: false, hpAfter: defenderHp };
  }

  const guarded = rng.next() < GUARD_CHANCE;
  const critical = rng.next() < CRIT_CHANCE;
  const critMul = critical ? CRIT_MULTIPLIER : 1;
  const variance = randRange(rng, DAMAGE_VARIANCE.min, DAMAGE_VARIANCE.max);

  let damage = Math.max(1, Math.round(attacker.atk * elementMul * critMul * variance));
  if (guarded) damage = Math.max(1, Math.ceil(damage / 2));

  return {
    result: guarded ? 'guard' : 'hit',
    damage,
    elementMul,
    critical,
    hpAfter: Math.max(0, defenderHp - damage),
  };
}
